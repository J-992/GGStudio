import { describe, expect, it } from 'vitest';
import { GameCore } from '../src/core/GameCore';
import { BALANCE } from '../src/data/balance';
import { phaseClockAdvance } from '../src/data/pacing';

const TICK_MS = 10;
const BASE_ACTION_MS = 700;
const ACTION_SIGMA = 0.5;
const DISTRACTION_MIN_MS = 3_000;
const DISTRACTION_MAX_MS = 8_000;
const DISTRACTION_GAP_MIN_MS = 45_000;
const DISTRACTION_GAP_MAX_MS = 90_000;
const SUBOPTIMAL_RATE = 0.05;
const FIRST_SEVEN_MIN_MS = 7 * 60_000;

/**
 * Deterministic stand-in for a 6-12 year old at the board: mulberry32 seeded
 * RNG (no Math.random anywhere), a ~700ms action cadence with lognormal-ish
 * jitter, a 3-8s distraction every 45-90s, and a 5% chance of pressing the
 * wrong button (buying when a merge was waiting, or trashing the lowest
 * ninja instead of merging). Pickups do not exist headlessly - they spawn
 * from the Phaser layer - so the child plays without potions or clocks.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function actionDelayMs(rng: () => number): number {
  const z = Math.max(-2.5, Math.min(2.5, gaussian(rng)));
  const delay = BASE_ACTION_MS * Math.exp(ACTION_SIGMA * z);
  return Math.max(150, Math.min(2500, delay));
}

interface Unrecoverable { fromS: number; toS: number }

interface RunReport {
  survived: boolean;
  gameOverAtS: number | null;
  longestActionGapS: number;
  longestActionGapFirst7minS: number;
  longestAffordableWaitS: number;
  longestAffordableWaitFirst7minS: number;
  longestStallS: number;
  unrecoverable: Unrecoverable[];
  purchasesPerMin: number[];
  mergesPerMin: number[];
  sellsPerMin: number[];
  tierTimeline: Record<number, number>;
  stageTimeline: Record<number, number>;
  minHealthRatio: number;
  secondsBelow30Pct: number;
  finalTier: number;
  finalStage: number;
}

function lowestSlot(core: GameCore): number | null {
  let best: number | null = null;
  core.board.slots.forEach((ninja, slot) => {
    if (ninja === null) return;
    if (best === null || ninja.tier < core.board.slots[best]!.tier) best = slot;
  });
  return best;
}

function occupiedSlots(core: GameCore): number[] {
  const found: number[] = [];
  core.board.slots.forEach((ninja, slot) => {
    if (ninja !== null) found.push(slot);
  });
  return found;
}

function simulate(seconds: number, seed: number): RunReport {
  const rng = mulberry32(seed);
  const core = new GameCore({ storage: null, now: () => 0 });
  const report: RunReport = {
    survived: true,
    gameOverAtS: null,
    longestActionGapS: 0,
    longestActionGapFirst7minS: 0,
    longestAffordableWaitS: 0,
    longestAffordableWaitFirst7minS: 0,
    longestStallS: 0,
    unrecoverable: [],
    purchasesPerMin: [],
    mergesPerMin: [],
    sellsPerMin: [],
    tierTimeline: {},
    stageTimeline: {},
    minHealthRatio: 1,
    secondsBelow30Pct: 0,
    finalTier: 1,
    finalStage: 1,
  };

  let elapsed = 0;
  let nextActionAt = actionDelayMs(rng);
  let distractionUntil = -1;
  let nextDistractionAt = DISTRACTION_GAP_MIN_MS +
    rng() * (DISTRACTION_GAP_MAX_MS - DISTRACTION_GAP_MIN_MS);
  let lastActionAt = 0;
  let affordableSince: number | null = null;
  let stallMs = 0;
  let unrecoverableLogged = false;
  let gameOver = false;

  const tally = (list: number[], minute: number): void => {
    while (list.length <= minute) list.push(0);
    list[minute]! += 1;
  };
  const noteGap = (now: number): void => {
    const gapS = (now - lastActionAt) / 1000;
    report.longestActionGapS = Math.max(report.longestActionGapS, gapS);
    if (now <= FIRST_SEVEN_MIN_MS) {
      report.longestActionGapFirst7minS = Math.max(report.longestActionGapFirst7minS, gapS);
    }
  };

  core.events.on('gameOver', () => { gameOver = true; });
  core.events.on('bossDefeated', (event) => {
    if (report.stageTimeline[event.stage] === undefined) {
      report.stageTimeline[event.stage] = elapsed / 1000;
    }
  });

  const tiersSeen = new Set<number>();
  while (elapsed < seconds * 1000 && !gameOver) {
    core.update(TICK_MS);
    elapsed += TICK_MS;

    const highest = core.highestTier;
    if (highest > 0 && !tiersSeen.has(highest)) {
      tiersSeen.add(highest);
      report.tierTimeline[highest] = elapsed / 1000;
    }

    if (elapsed % 1000 === 0) {
      const ratio = core.healthRatio;
      report.minHealthRatio = Math.min(report.minHealthRatio, ratio);
      if (ratio < 0.3) report.secondsBelow30Pct += 1;
    }

    const pair = core.board.mergePair();
    const canBuyNow = core.canBuy;
    const full = core.board.firstEmpty() === null;
    const trash = full ? lowestSlot(core) : null;
    const minute = Math.floor(elapsed / 60_000);

    const productive = pair !== null || canBuyNow || trash !== null;
    if (!productive) {
      stallMs += TICK_MS;
      report.longestStallS = Math.max(report.longestStallS, stallMs / 1000);
      if (stallMs > 60_000 && !unrecoverableLogged) {
        unrecoverableLogged = true;
        report.unrecoverable.push({ fromS: (elapsed - stallMs) / 1000, toS: elapsed / 1000 });
      }
    } else {
      stallMs = 0;
      unrecoverableLogged = false;
    }

    // A purchase window opens when the shop becomes affordable and closes
    // when it lapses or a merge spends the board's attention first; merges
    // legitimately outrank buying, so they close the window rather than
    // counting against it.
    if (canBuyNow && affordableSince === null) affordableSince = elapsed;
    if (!canBuyNow) affordableSince = null;

    if (elapsed >= nextDistractionAt) {
      distractionUntil = elapsed + DISTRACTION_MIN_MS +
        rng() * (DISTRACTION_MAX_MS - DISTRACTION_MIN_MS);
      nextDistractionAt = elapsed + DISTRACTION_GAP_MIN_MS +
        rng() * (DISTRACTION_GAP_MAX_MS - DISTRACTION_GAP_MIN_MS);
    }
    if (elapsed < distractionUntil || elapsed < nextActionAt) continue;

    const suboptimal = rng() < SUBOPTIMAL_RATE;
    const units = occupiedSlots(core);
    let purchased = false;

    if (pair !== null) {
      if (suboptimal && canBuyNow) {
        core.buy();
        tally(report.purchasesPerMin, minute);
        purchased = true;
      } else if (suboptimal && units.length > 2) {
        const victim = lowestSlot(core)!;
        core.drop(victim, { kind: 'trash' });
        tally(report.sellsPerMin, minute);
      } else {
        core.drop(pair[0], { kind: 'slot', slot: pair[1] });
        tally(report.mergesPerMin, minute);
      }
    } else if (canBuyNow) {
      core.buy();
      tally(report.purchasesPerMin, minute);
      purchased = true;
    } else if (trash !== null) {
      core.drop(trash, { kind: 'trash' });
      tally(report.sellsPerMin, minute);
    } else if (rng() < 0.1 && units.length > 0 && !full) {
      const from = units[Math.floor(rng() * units.length)]!;
      const empties: number[] = [];
      core.board.slots.forEach((ninja, slot) => { if (ninja === null) empties.push(slot); });
      const to = empties[Math.floor(rng() * empties.length)];
      if (to !== undefined) core.drop(from, { kind: 'slot', slot: to });
    } else {
      continue;
    }

    noteGap(elapsed);
    lastActionAt = elapsed;
    if (purchased && affordableSince !== null) {
      const waitS = (elapsed - affordableSince) / 1000;
      report.longestAffordableWaitS = Math.max(report.longestAffordableWaitS, waitS);
      if (elapsed <= FIRST_SEVEN_MIN_MS) {
        report.longestAffordableWaitFirst7minS =
          Math.max(report.longestAffordableWaitFirst7minS, waitS);
      }
      affordableSince = null;
    }
    nextActionAt = elapsed + actionDelayMs(rng);
  }

  report.survived = !gameOver;
  report.gameOverAtS = gameOver ? elapsed / 1000 : null;
  report.finalTier = core.progression.highestTierEverOwned;
  report.finalStage = core.boss.stage;
  return report;
}

function tierAt(report: RunReport, second: number): number {
  let best = 1;
  for (const [tier, atS] of Object.entries(report.tierTimeline)) {
    if (Number(atS) <= second) best = Math.max(best, Number(tier));
  }
  return best;
}

function summarize(label: string, report: RunReport): void {
  const perMinute = (list: number[]): string =>
    list.map((count, minute) => `m${minute}:${count}`).join(' ');
  console.warn(
    `[${label}] survived=${report.survived} gameOverAt=${report.gameOverAtS} ` +
    `finalTier=${report.finalTier} finalStage=${report.finalStage} ` +
    `tier@10min=${tierAt(report, 600)} ` +
    `gapMax=${report.longestActionGapS.toFixed(1)}s gapMax7m=${report.longestActionGapFirst7minS.toFixed(1)}s ` +
    `waitMax=${report.longestAffordableWaitS.toFixed(1)}s waitMax7m=${report.longestAffordableWaitFirst7minS.toFixed(1)}s ` +
    `stallMax=${report.longestStallS.toFixed(1)}s unrecoverable=${report.unrecoverable.length} ` +
    `hpMinRatio=${report.minHealthRatio.toFixed(2)} sBelow30%=${report.secondsBelow30Pct} ` +
    `purchases/min=[${perMinute(report.purchasesPerMin)}] ` +
    `merges/min=[${perMinute(report.mergesPerMin)}] ` +
    `sells/min=[${perMinute(report.sellsPerMin)}] ` +
    `tiers=${JSON.stringify(report.tierTimeline)} ` +
    `stages=${JSON.stringify(report.stageTimeline)}`,
  );
}

const tenMinute = simulate(600, 20260822);
const twentyMinute = simulate(1200, 20260822);
summarize('600s', tenMinute);
summarize('1200s', twentyMinute);

const total = (list: number[]): number => list.reduce((sum, count) => sum + count, 0);

describe('child-player pacing, 600s run', () => {
  it('keeps a competent child alive for the whole ten minutes', () => {
    expect(tenMinute.survived, `died at ${tenMinute.gameOverAtS}s`).toBe(true);
    expect(tenMinute.minHealthRatio).toBeGreaterThan(0);
  });

  it('never strands the child without a productive action for over 20 seconds', () => {
    expect(tenMinute.longestStallS).toBeLessThanOrEqual(20.1);
    expect(tenMinute.unrecoverable).toEqual([]);
  });

  it('keeps every opening-minute wait inside the attention span', () => {
    expect(tenMinute.longestActionGapFirst7minS).toBeLessThanOrEqual(12);
    expect(tenMinute.longestAffordableWaitFirst7minS).toBeLessThanOrEqual(10);
  });
});

describe('child-player pacing, 1200s run', () => {
  it('survives the full twenty minutes', () => {
    expect(twentyMinute.survived, `died at ${twentyMinute.gameOverAtS}s`).toBe(true);
  });

  it('never enters an unrecoverable state and never stalls past 20 seconds', () => {
    expect(twentyMinute.unrecoverable).toEqual([]);
    expect(twentyMinute.longestStallS).toBeLessThanOrEqual(20.1);
  });

  it('keeps every opening-minute wait inside the attention span', () => {
    expect(twentyMinute.longestActionGapFirst7minS).toBeLessThanOrEqual(12);
    expect(twentyMinute.longestAffordableWaitFirst7minS).toBeLessThanOrEqual(10);
  });

  it('climbs into the mid roster by the ten-minute retention checkpoint', () => {
    // The 2.4 growth ladder puts a competent child around tier 17 at the
    // checkpoint (measured 17 on the pinned seed); the band leaves room for
    // small economy nudges in both directions without letting a future tune
    // either stall the climb under tier 12 or sprint past tier 19, which
    // would leave the second act with nothing left to chase.
    const tier = tierAt(twentyMinute, 600);
    expect(tier).toBeGreaterThanOrEqual(12);
    expect(tier).toBeLessThanOrEqual(19);
  });

  it('lands the twenty-minute climb inside the curated ladder with room to spare', () => {
    expect(twentyMinute.finalTier).toBeGreaterThanOrEqual(19);
    expect(twentyMinute.finalTier).toBeLessThanOrEqual(BALANCE.tiers.count);
    expect(twentyMinute.finalStage).toBeGreaterThanOrEqual(20);
  });

  it('keeps action rates in sane bands', () => {
    const minutes = twentyMinute.purchasesPerMin.length;
    const purchasesPerMinute = total(twentyMinute.purchasesPerMin) / Math.max(1, minutes);
    const mergesPerMinute = total(twentyMinute.mergesPerMin) / Math.max(1, minutes);
    const sellsPerMinute = total(twentyMinute.sellsPerMin) / Math.max(1, minutes);
    expect(purchasesPerMinute).toBeGreaterThanOrEqual(2);
    expect(purchasesPerMinute).toBeLessThanOrEqual(40);
    expect(mergesPerMinute).toBeGreaterThanOrEqual(purchasesPerMinute * 0.4);
    expect(sellsPerMinute).toBeLessThanOrEqual(6);
  });

  it('never lets the line fall below a fifth of its health for a competent child', () => {
    expect(twentyMinute.minHealthRatio).toBeGreaterThan(0.2);
  });
});

describe('golden clock vs the tempo clock', () => {
  it('a boost advances the session clock at most 2x real time, not by the boosted dt', () => {
    const core = new GameCore({ storage: null, now: () => 0 });
    core.spawnTier(1);
    // Frame-sized steps: the boost burns down in real time inside update, so
    // one giant update would expire it before the multiplied dt is computed.
    core.startTimeBoost(10, 10_000);
    for (let tick = 0; tick < 1000; tick += 1) core.update(TICK_MS);
    // Ten real seconds of x10 boost used to skip the tempo clock ~100s ahead;
    // phaseClockAdvance caps that at 2x so a boost cannot fast-forward the
    // ten-minute retention curve.
    expect(core.metrics.timePlayedMs).toBeGreaterThanOrEqual(19_000);
    expect(core.metrics.timePlayedMs).toBeLessThanOrEqual(21_000);
    // The second boost lands on real-time progression, still inside 'opening'
    // (which runs to two minutes) instead of having been rushed into 'rising'.
    core.startTimeBoost(10, 10_000);
    for (let tick = 0; tick < 1000; tick += 1) core.update(TICK_MS);
    expect(core.metrics.timePlayedMs).toBeLessThanOrEqual(41_000);
    expect(core.tempo.id).toBe('opening');
  });

  it('phaseClockAdvance caps the boost contribution at 2x real time', () => {
    expect(phaseClockAdvance(10_000, { boostMultiplier: 10 })).toBe(20_000);
    expect(phaseClockAdvance(10_000, { boostMultiplier: 2 })).toBe(20_000);
    expect(phaseClockAdvance(10_000, { boostMultiplier: 1 })).toBe(10_000);
    expect(phaseClockAdvance(10_000)).toBe(10_000);
    expect(phaseClockAdvance(10_000, { boostMultiplier: 0 })).toBe(10_000);
    expect(phaseClockAdvance(-1, { boostMultiplier: 10 })).toBe(0);
  });
});
