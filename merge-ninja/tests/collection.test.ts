import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/data/balance';
import { BOSS_COUNT } from '../src/data/enemies';
import { collectionProgress, remainingCount } from '../src/systems/CollectionProgress';

describe('collection progress helpers', () => {
  it('counts what is left', () => {
    expect(remainingCount(0, 10)).toBe(10);
    expect(remainingCount(4, 10)).toBe(6);
    expect(remainingCount(10, 10)).toBe(0);
  });

  it('never reports a negative remainder', () => {
    expect(remainingCount(12, 10)).toBe(0);
    // A nonsense negative unlocked count counts as zero unlocked.
    expect(remainingCount(-3, 10)).toBe(10);
  });

  it('summarises have/left for the badge and headers', () => {
    expect(collectionProgress(23, 66)).toEqual({ have: 23, left: 43 });
    expect(collectionProgress(66, 66)).toEqual({ have: 66, left: 0 });
  });

  it('tracks the real roster sizes', () => {
    const ninjas = collectionProgress(BALANCE.tiers.count, BALANCE.tiers.count);
    const bosses = collectionProgress(BOSS_COUNT, BOSS_COUNT);
    expect(ninjas.left).toBe(0);
    expect(bosses.left).toBe(0);
  });
});
