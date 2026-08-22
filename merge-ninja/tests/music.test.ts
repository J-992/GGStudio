import { describe, expect, it } from 'vitest';
import { MUSIC_FACTS } from '../src/audio/Music';

/**
 * The composition itself is data; these checks pin its shape so a retune
 * cannot silently break the 16-bar loop or the scheduler's assumptions.
 */
describe('music composition facts', () => {
  it('is a sixteen-bar loop at 132 BPM', () => {
    expect(MUSIC_FACTS.bars).toBe(16);
    expect(MUSIC_FACTS.loopSteps).toBe(16 * 16);
    expect(MUSIC_FACTS.bpm).toBe(132);
    // One sixteenth note at 132 BPM leaves comfortable scheduler headroom.
    expect(MUSIC_FACTS.stepSec).toBeCloseTo(60 / 132 / 4, 6);
  });

  it('carries a dense lead line inside the loop bounds', () => {
    expect(MUSIC_FACTS.leadNotes).toBeGreaterThanOrEqual(48);
  });

  it('keeps the bass contour aligned with eight-note positions', () => {
    expect(MUSIC_FACTS.bassContour).toBe(8);
  });
});
