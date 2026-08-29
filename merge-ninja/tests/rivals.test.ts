import { describe, expect, it } from 'vitest';
import { isRivalMilestoneStage, nextRivalIndex, rivalMilestone, upcomingRivals } from '../src/data/rivals';

describe('rival ladder milestones', () => {
  it('turns the existing arena chapters into the first rival goals', () => {
    expect([0, 1, 2, 3, 4].map((index) => rivalMilestone(index).stage)).toEqual([10, 19, 28, 37, 50]);
  });

  it('always chooses a rival strictly ahead of the player', () => {
    expect(nextRivalIndex(1)).toBe(0);
    expect(nextRivalIndex(10)).toBe(1);
    expect(upcomingRivals(19)).toMatchObject([{ stage: 28 }, { stage: 37 }, { stage: 50 }]);
  });

  it('distinguishes milestone arrivals from routine stages', () => {
    expect([9, 10, 11, 19, 28, 37, 50].map(isRivalMilestoneStage)).toEqual([
      false, true, false, true, true, true, true,
    ]);
  });
});
