import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../src/core/EventBus';
import { RetentionFunnel, type RetentionMeasure } from '../src/platform/retentionFunnel';

describe('retention funnel', () => {
  it('reports the guided opening once, step by step', () => {
    const reported: RetentionMeasure[] = [];
    const funnel = new RetentionFunnel((measure) => reported.push(measure));

    funnel.startTutorial();
    funnel.startTutorial();
    funnel.handle({ type: 'ninjaSpawned' } as GameEvent, 1);
    funnel.handle({ type: 'ninjaSpawned' } as GameEvent, 2);
    funnel.handle({ type: 'ninjaMerged' } as GameEvent, 2);
    funnel.handle({ type: 'powerupCollected', id: 'coinFrenzy' }, 2);
    funnel.handle({ type: 'coinFrenzyFinished' }, 2);
    funnel.handle({ type: 'tutorialCompleted' }, 2);

    expect(reported).toEqual([
      { category: 'tutorial', what: 'onboarding', action: 'start' },
      { category: 'tutorial', what: 'buy-1', action: 'complete' },
      { category: 'tutorial', what: 'buy-2', action: 'complete' },
      { category: 'tutorial', what: 'merge', action: 'complete' },
      { category: 'tutorial', what: 'coin-frenzy', action: 'interact' },
      { category: 'tutorial', what: 'coin-frenzy', action: 'complete' },
      { category: 'tutorial', what: 'onboarding', action: 'complete' },
    ]);
  });

  it('measures only the authored chapter stages and deduplicates reload noise', () => {
    const reported: RetentionMeasure[] = [];
    const funnel = new RetentionFunnel((measure) => reported.push(measure));

    funnel.startStage(1);
    funnel.handle({ type: 'bossSpawned', stage: 2 } as GameEvent, 0);
    funnel.handle({ type: 'bossSpawned', stage: 10 } as GameEvent, 0);
    funnel.handle({ type: 'bossSpawned', stage: 10 } as GameEvent, 0);
    funnel.handle({ type: 'bossDefeated', stage: 10 } as GameEvent, 0);

    expect(reported).toEqual([
      { category: 'stage', what: '1', action: 'start' },
      { category: 'stage', what: '10', action: 'start' },
      { category: 'stage', what: '10', action: 'complete' },
    ]);
  });
});
