import { describe, expect, it } from 'vitest';
import { TIMING } from '../config';
import { TimingAssist } from '../game/TimingAssist';
import { evaluate } from '../game/TimingEvaluator';

describe('adaptive timing assistance', () => {
  it('lets an observed cold-open press connect without changing Perfect', () => {
    const assist = new TimingAssist();
    const assisted = evaluate(9.5, 10, assist.window);

    expect(assisted.quality).toBe('good');
    expect(evaluate(10.08, 10, assist.window).quality).toBe('perfect');
  });

  it('narrows back to the authored window after consistently accurate presses', () => {
    const assist = new TimingAssist();
    for (let i = 0; i < 24; i += 1) assist.observe(i % 2 === 0 ? -70 : 60);

    expect(assist.window.goodEarlyMs).toBeCloseTo(TIMING.goodEarlyMs, -1);
    expect(assist.window.goodLateMs).toBeCloseTo(TIMING.goodLateMs, -1);
    expect(evaluate(9.5, 10, assist.window).quality).toBe('whiff');
  });

  it('can resume from a saved rolling estimate', () => {
    const assist = new TimingAssist(180, 12);
    expect(assist.snapshot.samples).toBe(12);
    expect(assist.window.goodEarlyMs).toBeLessThan(TIMING.assist.maxEarlyMs);
  });
});
