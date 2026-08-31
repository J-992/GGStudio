import type { RunStats } from './Progression';

/**
 * Three goals a day, seeded from the date.
 *
 * The only thing that brought a player back was the ninja roster, and that runs
 * out after four unlocks. These are the reason to open the game on the second
 * day: small, specific, finishable in a run or two, and worth Mastery so they
 * feed the progression that already exists rather than inventing a second one.
 *
 * Two rules keep this the right side of the line the rest of the game is on:
 *
 *   1. Every goal rewards playing WELL, never playing LONG. There is no "spend
 *      ten minutes" objective, because that is a tax on the player's day rather
 *      than a thing to be good at.
 *   2. Nothing is lost by missing a day. There is no streak, no decay and no
 *      catch-up debt, so coming back after a week is not a punishment.
 *
 * The set is derived from the date rather than stored, so it needs no server
 * and no clock authority: two players on the same day get the same three, and a
 * player who changes their device clock gets a different day's set and no
 * advantage, because completion is capped at three goals a day either way.
 */

export interface Daily {
  readonly id: string;
  readonly label: string;
  /** How far along the player is, in the goal's own units. */
  readonly progress: number;
  readonly target: number;
  readonly done: boolean;
  /** Mastery paid on completion. */
  readonly reward: number;
}

type Metric = 'kills' | 'perfects' | 'flows' | 'score' | 'combo' | 'held';

interface Goal {
  readonly id: string;
  readonly metric: Metric;
  readonly label: (target: number) => string;
  /** Candidate targets, hardest last; the day's seed picks one. */
  readonly targets: readonly number[];
  readonly reward: number;
}

const GOALS: readonly Goal[] = [
  {
    id: 'perfects',
    metric: 'perfects',
    label: (n) => `Land ${n} perfect strikes`,
    targets: [12, 18, 25],
    reward: 120,
  },
  {
    id: 'combo',
    metric: 'combo',
    label: (n) => `Reach a ${n} combo`,
    targets: [15, 25, 35],
    reward: 150,
  },
  {
    id: 'flows',
    metric: 'flows',
    label: (n) => `Finish ${n} Flow ${n === 1 ? 'chain' : 'chains'}`,
    targets: [2, 3, 4],
    reward: 160,
  },
  {
    id: 'kills',
    metric: 'kills',
    label: (n) => `Cut down ${n} enemies`,
    targets: [40, 60, 90],
    reward: 100,
  },
  {
    id: 'score',
    metric: 'score',
    label: (n) => `Score ${n.toLocaleString()} in one run`,
    targets: [4000, 7000, 11000],
    reward: 140,
  },
  {
    id: 'held',
    metric: 'held',
    label: (n) => `Hold your nerve on ${n} feints`,
    targets: [4, 7, 10],
    reward: 130,
  },
];

/** Days since the epoch in LOCAL time, which is the day the player is having. */
export function dayKey(at: Date = new Date()): string {
  const y = at.getFullYear();
  const m = `${at.getMonth() + 1}`.padStart(2, '0');
  const d = `${at.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Small deterministic hash, so a date always produces the same three goals. */
function hash(text: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** The day's three goals, hardest-target choice included. */
export function goalsFor(day: string): { id: string; metric: Metric; label: string; target: number; reward: number }[] {
  // Draw three distinct goals by walking the list from a seeded offset, which
  // gives a stable set without needing to shuffle or reject duplicates.
  const start = Math.floor(hash(day, 1) * GOALS.length);
  const stride = 1 + Math.floor(hash(day, 2) * (GOALS.length - 1));
  const picked: Goal[] = [];
  for (let i = 0; picked.length < 3 && i < GOALS.length * 2; i++) {
    const goal = GOALS[(start + i * stride) % GOALS.length];
    if (!picked.includes(goal)) picked.push(goal);
  }
  // Tier by position, not by roll: one goal a player can finish in a run, one
  // that takes a couple, one worth coming back for. Rolling each independently
  // meant some days opened with three of the hardest tier, which is exactly the
  // day a player decides the goals are not for them.
  return picked.map((goal, i) => {
    const tier = Math.min(i, goal.targets.length - 1);
    return {
      id: goal.id,
      metric: goal.metric,
      label: goal.label(goal.targets[tier]),
      target: goal.targets[tier],
      reward: goal.reward,
    };
  });
}

/** What one run contributed, in each goal's own units. */
export interface DailyRun extends RunStats {
  /** Best combo reached during the run, not the combo at death. */
  bestCombo: number;
  /** Feints correctly left alone. */
  held: number;
}

function valueFor(metric: Metric, run: DailyRun): number {
  switch (metric) {
    case 'kills': return run.kills;
    case 'perfects': return run.perfects;
    case 'flows': return run.flows;
    case 'combo': return run.bestCombo;
    case 'held': return run.held;
    case 'score': return run.score;
  }
}

/**
 * Whether a metric accumulates across the day or is a personal best within one
 * run. "Reach a 25 combo" cannot be added up across five runs; "cut down 60
 * enemies" can, and asking a player to do it in one would be a different and
 * much harder goal than the label promises.
 */
function isPerRun(metric: Metric): boolean {
  return metric === 'combo' || metric === 'score';
}

export interface DailyState {
  day: string;
  /** Accumulated progress per goal id. */
  progress: Record<string, number>;
  /** Goal ids already paid out, so Mastery is never awarded twice. */
  claimed: string[];
}

export function emptyState(day = dayKey()): DailyState {
  return { day, progress: {}, claimed: [] };
}

/** Rolls the state over to today if it belongs to an earlier day. */
export function forToday(state: DailyState, day = dayKey()): DailyState {
  return state.day === day ? state : emptyState(day);
}

/** The day's goals with the player's progress filled in. */
export function dailiesFor(state: DailyState, day = dayKey()): Daily[] {
  const today = forToday(state, day);
  return goalsFor(day).map((goal) => {
    const progress = Math.min(goal.target, today.progress[goal.id] ?? 0);
    return {
      id: goal.id,
      label: goal.label,
      progress,
      target: goal.target,
      done: progress >= goal.target,
      reward: goal.reward,
    };
  });
}

/**
 * Folds a finished run into the day.
 *
 * @returns the updated state and the Mastery earned by goals completed by THIS
 *          run, which is what the game hands to the progression system.
 */
export function commitDaily(
  state: DailyState,
  run: DailyRun,
  day = dayKey(),
): { state: DailyState; mastery: number; completed: Daily[] } {
  const today = forToday(state, day);
  const progress = { ...today.progress };
  const claimed = [...today.claimed];
  const completed: Daily[] = [];
  let mastery = 0;

  for (const goal of goalsFor(day)) {
    const value = valueFor(goal.metric, run);
    const before = progress[goal.id] ?? 0;
    progress[goal.id] = isPerRun(goal.metric) ? Math.max(before, value) : before + value;

    if (progress[goal.id] >= goal.target && !claimed.includes(goal.id)) {
      claimed.push(goal.id);
      mastery += goal.reward;
      completed.push({
        id: goal.id,
        label: goal.label,
        progress: goal.target,
        target: goal.target,
        done: true,
        reward: goal.reward,
      });
    }
  }

  return { state: { day, progress, claimed }, mastery, completed };
}
