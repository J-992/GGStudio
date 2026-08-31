import { describe, expect, it } from 'vitest';
import { PROFILES, median, runMany } from './RunModel';
import { UNLOCKS } from '../config';
import { masteryFor } from '../game/Progression';

/**
 * Run-shape targets, measured by simulating whole runs against the real
 * systems. These are the design goals of the product hypothesis expressed as
 * assertions, so a config change that quietly ruins the first minute fails CI
 * rather than being discovered in a Poki playtest.
 *
 * Bounds are deliberately loose: they pin the shape, not the exact numbers.
 */

const RUNS = 24;

describe('First-minute experience', () => {
  const firstTimers = runMany(PROFILES.firstTimer, RUNS);
  const casuals = runMany(PROFILES.casual, RUNS);

  it('never lets a first-timer lose a heart during the tutorial threats', () => {
    for (const run of firstTimers) {
      if (run.tFirstDamage !== null) expect(run.tFirstDamage).toBeGreaterThan(6);
    }
  });

  it('gets a first-timer to their first Flow inside the first minute', () => {
    const times = firstTimers.map((r) => r.tFirstFlow).filter((t): t is number => t !== null);
    expect(times.length).toBeGreaterThanOrEqual(RUNS * 0.75);
    expect(median(times)).toBeLessThan(60);
  });

  it('does not hand out the first Flow instantly either', () => {
    const times = casuals.map((r) => r.tFirstFlow).filter((t): t is number => t !== null);
    expect(median(times)).toBeGreaterThan(10);
  });

  it('lands a first-timer a perfect early enough to notice the difference', () => {
    const times = firstTimers.map((r) => r.tFirstPerfect).filter((t): t is number => t !== null);
    expect(times.length).toBeGreaterThanOrEqual(RUNS * 0.9);
    expect(median(times)).toBeLessThan(25);
  });
});

describe('Cold-open retention', () => {
  it('makes the first run a protected Flow showcase for the observed audience', () => {
    const runs = runMany(PROFILES.coldOpen, RUNS, { firstFlowShowcase: true });
    expect(runs.every((run) => run.tFirstDamage === null)).toBe(true);
    expect(runs.every((run) => run.tFirstFlow !== null && run.tFirstFlow <= 22)).toBe(true);
    expect(runs.every((run) => run.tFirstFlowComplete !== null)).toBe(true);
    expect(median(runs.map((run) => run.survived))).toBeGreaterThanOrEqual(20);
  }, 15_000);

  it('removes the immediate run-two death cliff for the same cold-open player', () => {
    const runs = runMany(PROFILES.coldOpen, RUNS);
    expect(median(runs.map((run) => run.survived))).toBeGreaterThan(20);
  }, 15_000);
});

describe('Run shape', () => {
  it('gives competent players runs in the intended 1.5-3.5 minute band', () => {
    const runs = runMany(PROFILES.competent, RUNS);
    const m = median(runs.map((r) => r.survived));
    expect(m).toBeGreaterThan(75);
    // Raised from 260 when the Flow reaction windows were widened after
    // playtest feedback. A forgiving Flow means more completed chains, and a
    // completed chain sweeps the field — so competent runs got longer by
    // design. The bound still exists to catch a run that never ends.
    expect(m).toBeLessThan(310);
  });

  // This compares 72 whole deterministic runs. Keep the test strict, but give
  // slower shared CI runners enough time to finish the actual simulation.
  it('rewards skill with materially longer runs', () => {
    const first = median(runMany(PROFILES.firstTimer, RUNS).map((r) => r.survived));
    const casual = median(runMany(PROFILES.casual, RUNS).map((r) => r.survived));
    const expert = median(runMany(PROFILES.expert, RUNS).map((r) => r.survived));
    expect(casual).toBeGreaterThan(first);
    expect(expert).toBeGreaterThan(casual * 1.4);
  }, 15_000);

  it('keeps ending runs — nobody survives forever on the current ramp', () => {
    const runs = runMany(PROFILES.casual, RUNS);
    for (const r of runs) expect(r.survived).toBeLessThan(400);
  });

  it('delivers repeat Flows rather than a single one per run', () => {
    const runs = runMany(PROFILES.competent, RUNS);
    expect(median(runs.map((r) => r.flowChains))).toBeGreaterThanOrEqual(2);
  });
});

describe('Mashing is strictly worse than reading', () => {
  const masher = runMany(PROFILES.masher, RUNS);
  const competent = runMany(PROFILES.competent, RUNS);

  it('kills a masher far sooner than a reader', () => {
    expect(median(masher.map((r) => r.survived))).toBeLessThan(
      median(competent.map((r) => r.survived)) * 0.6,
    );
  });

  it('scores a masher far below a reader', () => {
    expect(median(masher.map((r) => r.score))).toBeLessThan(
      median(competent.map((r) => r.score)) * 0.5,
    );
  });

  it('produces mostly whiffs for a masher', () => {
    // Asserted across the whole set rather than one run: a single seed can
    // hand a masher a lucky opening, and the design claim is about the
    // distribution — swinging blind is strictly worse than reading.
    const whiffs = masher.reduce((n, r) => n + r.whiffs, 0);
    const perfects = masher.reduce((n, r) => n + r.perfects, 0);
    expect(whiffs).toBeGreaterThan(perfects);
    // The claim that actually matters: mashing is not a strategy. A masher's
    // run is a fraction of a reader's, whatever the seed.
    const mashed = median(masher.map((r) => r.survived));
    const read = median(runMany(PROFILES.casual, 12).map((r) => r.survived));
    expect(mashed).toBeLessThan(read * 0.4);
  });
});

describe('Unlock pacing', () => {
  it('unlocks the second ninja within the first couple of real runs', () => {
    const runs = runMany(PROFILES.casual, RUNS);
    let mastery = 0;
    let runsNeeded = 0;
    for (const r of runs) {
      mastery += masteryFor({
        kills: r.perfects + r.goods,
        perfects: r.perfects,
        flows: r.flowChains,
        score: r.score,
      });
      runsNeeded += 1;
      if (mastery >= UNLOCKS.thresholds[1]) break;
    }
    expect(runsNeeded).toBeLessThanOrEqual(2);
  });

  it('keeps the last ninja aspirational without being a grind', () => {
    // The casual player is the anchor: the final ninja should take a handful of
    // sessions of ordinary play, while never demanding dozens of runs. Strong
    // players are allowed to get there much faster — that is mastery paying out.
    const runsNeededFor = (profile: (typeof PROFILES)[keyof typeof PROFILES]) => {
      let mastery = 0;
      let runsNeeded = 0;
      for (const r of runMany(profile, RUNS)) {
        mastery += masteryFor({
          kills: r.perfects + r.goods,
          perfects: r.perfects,
          flows: r.flowChains,
          score: r.score,
        });
        runsNeeded += 1;
        if (mastery >= UNLOCKS.thresholds[3]) break;
      }
      return runsNeeded;
    };
    const casual = runsNeededFor(PROFILES.casual);
    expect(casual).toBeGreaterThanOrEqual(4);
    expect(casual).toBeLessThanOrEqual(24);
    expect(runsNeededFor(PROFILES.competent)).toBeLessThanOrEqual(8);
  });
});

describe('Guarded enemies', () => {
  it('holds guards back until players are past the opening minute', () => {
    // A first-timer dies before the mechanic is introduced: nobody meets a
    // guard while they are still learning which side to press.
    const runs = runMany(PROFILES.firstTimer, 24);
    expect(median(runs.map((r) => r.guardBreaks))).toBe(0);
  });

  it('makes guards a real part of a long run without dominating it', () => {
    const runs = runMany(PROFILES.competent, 24);
    const breaks = median(runs.map((r) => r.guardBreaks));
    const kills = median(runs.map((r) => r.perfects + r.goods));
    expect(breaks).toBeGreaterThan(3);
    // Guard breaks stay a minority of the player's swings: the game is still
    // about reading single threats, with guards as the complication.
    expect(breaks).toBeLessThan(kills * 0.5);
  });

  it('does not let guards turn a good run into an unwinnable one', () => {
    const runs = runMany(PROFILES.competent, 24);
    const m = median(runs.map((r) => r.survived));
    expect(m).toBeGreaterThan(75);
    expect(m).toBeLessThan(310);
  });
});
