import { describe, expect, it } from 'vitest';
import { nextRivalIndex, rivalMilestone, upcomingRivals } from '../src/data/rivals';

describe('rival ladder milestones', () => {
  it('starts with reachable stage goals that widen as the player climbs', () => {
    expect([0, 1, 2, 3, 4].map((index) => rivalMilestone(index).stage)).toEqual([2, 4, 7, 11, 16]);
  });

  it('always chooses a rival strictly ahead of the player', () => {
    expect(nextRivalIndex(1)).toBe(0);
    expect(nextRivalIndex(2)).toBe(1);
    expect(upcomingRivals(11)).toMatchObject([{ stage: 16 }, { stage: 22 }, { stage: 29 }]);
  });
});
