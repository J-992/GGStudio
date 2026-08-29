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
    funnel.handle({ type: 'tutorialCompleted' }, 2);

    expect(reported).toEqual([
      { category: 'tutorial', what: 'onboarding', action: 'start' },
      { category: 'tutorial', what: 'buy-1', action: 'start' },
      { category: 'tutorial', what: 'buy-1', action: 'complete' },
      { category: 'tutorial', what: 'buy-2', action: 'start' },
      { category: 'tutorial', what: 'buy-2', action: 'complete' },
      { category: 'tutorial', what: 'merge', action: 'start' },
      { category: 'tutorial', what: 'merge', action: 'complete' },
      { category: 'tutorial', what: 'boss-tap', action: 'start' },
      { category: 'tutorial', what: 'boss-tap', action: 'complete' },
      { category: 'tutorial', what: 'onboarding', action: 'complete' },
    ]);
  });

  it('pairs contextual powerup exposure with interaction and lesson completion', () => {
    const reported: RetentionMeasure[] = [];
    const funnel = new RetentionFunnel((measure) => reported.push(measure));

    funnel.startPowerupLesson();
    funnel.handle({ type: 'powerupSpawned', id: 'shurikenFrenzy', travelMs: 11_500 }, 2);
    funnel.handle({ type: 'powerupCollected', id: 'shurikenFrenzy' }, 2);
    funnel.handle({ type: 'powerupCoachCompleted', id: 'shurikenFrenzy' }, 2);

    expect(reported).toEqual([
      { category: 'tutorial', what: 'powerup-context', action: 'start' },
      { category: 'powerup', what: 'shurikenFrenzy', action: 'visible' },
      { category: 'powerup', what: 'shurikenFrenzy', action: 'interact' },
      { category: 'tutorial', what: 'powerup-context', action: 'complete' },
    ]);
  });

  it('records active-time reach without counting duplicate frames', () => {
    const reported: RetentionMeasure[] = [];
    const funnel = new RetentionFunnel((measure) => reported.push(measure));

    funnel.updateActive(90_000);
    funnel.startGameplay(2);
    funnel.updateActive(29_999);
    funnel.updateActive(1);
    funnel.updateActive(60_000);

    expect(reported).toEqual([
      { category: 'run', what: 'active', action: 'start' },
      { category: 'session-time', what: '30s', action: 'reached' },
      { category: 'session-time', what: '60s', action: 'reached' },
      { category: 'session-time', what: '90s', action: 'reached' },
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

  it('reports a real failure when a run ends on an active authored stage', () => {
    const reported: RetentionMeasure[] = [];
    const funnel = new RetentionFunnel((measure) => reported.push(measure));

    funnel.startGameplay(10);
    funnel.handle({ type: 'gameOver', stage: 10 } as GameEvent, 4);

    expect(reported).toEqual([
      { category: 'run', what: 'active', action: 'start' },
      { category: 'stage', what: '10', action: 'start' },
      { category: 'stage', what: '10', action: 'fail' },
      { category: 'run', what: 'active', action: 'fail' },
    ]);
  });

  it('measures the sticker runway and conscious style interaction', () => {
    const reported: RetentionMeasure[] = [];
    const funnel = new RetentionFunnel((measure) => reported.push(measure));

    funnel.handle({
      type: 'bossStickerCollected', id: 'crimson-dojo-1', pageId: 'crimson-dojo',
      stage: 1, slot: 0, progress: 1, total: 3, textureKey: 'seal-1', pageComplete: false,
    }, 2);
    funnel.handle({
      type: 'bossStickerCollected', id: 'crimson-dojo-3', pageId: 'crimson-dojo',
      stage: 10, slot: 2, progress: 3, total: 3, textureKey: 'seal-3', pageComplete: true,
    }, 2);
    funnel.handle({ type: 'dojoStyleUnlocked', id: 'crimson-dojo' }, 2);
    funnel.handle({ type: 'dojoStyleEquipped', id: 'crimson-dojo', source: 'unlock' }, 2);
    funnel.handle({ type: 'dojoStyleEquipped', id: 'classic', source: 'player' }, 2);

    expect(reported).toEqual([
      { category: 'sticker-page', what: 'crimson-dojo', action: 'start' },
      { category: 'sticker', what: 'crimson-dojo-1', action: 'reached' },
      { category: 'sticker', what: 'crimson-dojo-3', action: 'reached' },
      { category: 'sticker-page', what: 'crimson-dojo', action: 'complete' },
      { category: 'dojo-style', what: 'crimson-dojo', action: 'visible' },
      { category: 'dojo-style', what: 'classic', action: 'interact' },
    ]);
  });
});
