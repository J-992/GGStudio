import { describe, expect, it } from 'vitest';
import { GameCore } from '../src/core/GameCore';
import { improveBest, normalizeBest } from '../src/systems/BestRun';
import type { BestRun, RecordFlags } from '../src/systems/BestRun';
import type { StorageLike } from '../src/data/types';

class FakeStorage implements StorageLike {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
  removeItem(key: string): void { this.data.delete(key); }
}

const RUN = { stage: 12, tier: 8, coins: 4_500, timeMs: 300_000 };

describe('improveBest', () => {
  it('treats a first-ever run as records for everything it actually scored', () => {
    const result = improveBest(null, RUN);
    expect(result.best).toEqual(RUN);
    expect(result.records).toEqual({ stage: true, tier: true, coins: true, timeMs: true });
    expect(result.beatAny).toBe(true);
    expect(result.previous).toEqual({ stage: 0, tier: 0, coins: 0, timeMs: 0 });
  });

  it('never awards a record for a stat that scored nothing', () => {
    const result = improveBest(null, { stage: 1, tier: 1, coins: 0, timeMs: 0 });
    expect(result.records.coins).toBe(false);
    expect(result.records.timeMs).toBe(false);
    expect(result.records.stage).toBe(true);
  });

  it('keeps each stat independently, so a worse run cannot lower a record', () => {
    const worse = improveBest(RUN, { stage: 3, tier: 20, coins: 10, timeMs: 10 });
    expect(worse.best).toEqual({ stage: 12, tier: 20, coins: 4_500, timeMs: 300_000 });
    expect(worse.records).toEqual({ stage: false, tier: true, coins: false, timeMs: false });
    expect(worse.beatAny).toBe(true);
  });

  it('reports no celebration when a run beats nothing', () => {
    const result = improveBest(RUN, { stage: 1, tier: 1, coins: 1, timeMs: 1 });
    expect(result.beatAny).toBe(false);
    expect(result.best).toEqual(RUN);
  });

  it('requires strictly beating the record, not matching it', () => {
    const result = improveBest(RUN, RUN);
    expect(result.records).toEqual({ stage: false, tier: false, coins: false, timeMs: false });
    expect(result.beatAny).toBe(false);
  });

  it('floors fractional values and discards impossible ones', () => {
    const result = improveBest(null, {
      stage: 7.9,
      tier: Number.NaN,
      coins: -100,
      timeMs: Number.POSITIVE_INFINITY,
    });
    expect(result.best).toEqual({ stage: 7, tier: 0, coins: 0, timeMs: 0 });
  });
});

describe('normalizeBest', () => {
  it('reads anything corrupt as no record yet', () => {
    const empty = { stage: 0, tier: 0, coins: 0, timeMs: 0 };
    expect(normalizeBest(null)).toEqual(empty);
    expect(normalizeBest('nonsense')).toEqual(empty);
    expect(normalizeBest({ stage: 'x', tier: {}, coins: [], timeMs: null })).toEqual(empty);
  });

  it('keeps the good fields of a partly corrupt record', () => {
    expect(normalizeBest({ stage: 9, coins: 'x' })).toEqual({ stage: 9, tier: 0, coins: 0, timeMs: 0 });
  });
});

describe('personal bests across runs', () => {
  it('survives the defeat that wiped the run save', () => {
    const storage = new FakeStorage();
    const game = new GameCore({ storage, now: () => 0 });
    game.spawnTier(6);
    while (game.boss.stage < 4) game.skipEnemy();
    game.endRunForTest();

    const next = new GameCore({ storage, now: () => 0 });
    expect(next.best.stage).toBeGreaterThanOrEqual(4);
    expect(next.best.tier).toBeGreaterThanOrEqual(6);
  });

  it('reports the beaten records on the game over event', () => {
    const storage = new FakeStorage();
    const game = new GameCore({ storage, now: () => 0 });
    game.spawnTier(5);
    while (game.boss.stage < 3) game.skipEnemy();

    let records: RecordFlags | null = null;
    let best: BestRun | null = null;
    game.events.on('gameOver', (event) => { records = event.records; best = event.best; });
    game.endRunForTest();

    expect(records).not.toBeNull();
    expect(records!.stage).toBe(true);
    expect(best!.stage).toBeGreaterThanOrEqual(3);
  });

  it('banks the run that an ascension leaves behind', () => {
    const storage = new FakeStorage();
    const game = new GameCore({ storage, now: () => 0 });
    game.spawnTier(9);
    while (!game.canAscend) game.skipEnemy();
    const reached = game.boss.stage;
    game.ascend();

    expect(game.best.stage).toBe(reached);
    expect(game.best.tier).toBeGreaterThanOrEqual(9);
    // The run itself really did reset underneath the record.
    expect(game.boss.stage).toBe(1);
  });
});
