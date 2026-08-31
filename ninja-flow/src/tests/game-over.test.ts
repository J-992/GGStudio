import { describe, expect, it, vi } from 'vitest';
import { unlockState } from '../game/Progression';
import { GameOverScreen } from '../ui/GameOver';

describe('game-over retry', () => {
  it('restarts from one background tap while leaving controls clickable', () => {
    const parent = document.createElement('div');
    const screen = new GameOverScreen(parent);
    const play = vi.fn();
    screen.setHandlers(play, vi.fn(), vi.fn(), vi.fn());
    screen.show({
      score: 100,
      best: 100,
      previousBest: 0,
      maxCombo: 1,
      flowChains: 0,
      unlock: unlockState(0),
      newlyUnlocked: [],
      completedDailies: [],
      canContinue: false,
      showcaseComplete: false,
      selected: 'fox',
      available: ['fox'],
    });

    parent.querySelector<HTMLElement>('.over')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(play).toHaveBeenCalledTimes(1);
    expect(parent.textContent).toContain('TAP ANYWHERE');
  });
});
