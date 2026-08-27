import type { GameEvent } from '../core/EventBus';

export interface RetentionMeasure {
  readonly category: string;
  readonly what: string;
  readonly action: string;
}

type RetentionSink = (measure: RetentionMeasure) => void;
type TutorialCheckpoint = 'buy-1' | 'buy-2' | 'merge' | 'boss-tap';

/**
 * Small, deliberately paired Poki telemetry.
 *
 * Progress rows always use start -> complete/fail and interaction rows always
 * use visible -> interact. One-off facts use `reached`. Keeping those shapes
 * honest is what makes Poki's Started, Completed, Failed and Left columns
 * useful instead of displaying zeroes for unmatched actions.
 */
export class RetentionFunnel {
  private readonly sent = new Set<string>();
  private tutorialActive = false;
  private tutorialStep: TutorialCheckpoint | null = null;
  private powerupLessonActive = false;
  private activeStage: number | null = null;
  private runStarted = false;
  private stickerPageActive = false;
  private activePlayMs = 0;

  constructor(private readonly report: RetentionSink) {}

  startTutorial(purchases = 0, merges = 0): void {
    this.tutorialActive = true;
    this.send('tutorial', 'onboarding', 'start');
    const step: TutorialCheckpoint = purchases === 0
      ? 'buy-1'
      : purchases === 1
        ? 'buy-2'
        : merges === 0 ? 'merge' : 'boss-tap';
    this.startTutorialStep(step);
  }

  startPowerupLesson(): void {
    if (this.powerupLessonActive) return;
    this.powerupLessonActive = true;
    this.send('tutorial', 'powerup-context', 'start');
  }

  startGameplay(stage: number): void {
    if (!this.runStarted) {
      this.runStarted = true;
      this.send('run', 'active', 'start');
    }
    this.startStage(stage);
  }

  startStickerPage(): void {
    if (this.stickerPageActive) return;
    this.stickerPageActive = true;
    this.send('sticker-page', 'crimson-dojo', 'start');
  }

  /** Count only time Poki also considers active gameplay: no menus or game-over screen. */
  updateActive(dtMs: number): void {
    if (!this.runStarted || !Number.isFinite(dtMs) || dtMs <= 0) return;
    this.activePlayMs += dtMs;
    for (const seconds of RetentionFunnel.sessionSeconds) {
      if (this.activePlayMs >= seconds * 1_000) this.send('session-time', `${seconds}s`, 'reached');
    }
  }

  startStage(stage: number): void {
    const safeStage = Math.max(1, Math.floor(stage));
    if (!RetentionFunnel.chapterStages.has(safeStage)) return;
    this.activeStage = safeStage;
    this.send('stage', String(safeStage), 'start');
  }

  handle(event: GameEvent, purchases: number): void {
    if (event.type === 'bossSpawned') this.startStage(event.stage);
    if (event.type === 'bossDefeated' && RetentionFunnel.chapterStages.has(event.stage)) {
      this.send('stage', String(event.stage), 'complete');
      if (this.activeStage === event.stage) this.activeStage = null;
    }
    if (event.type === 'gameOver') {
      if (this.activeStage === event.stage) this.send('stage', String(event.stage), 'fail');
      this.send('run', 'active', 'fail');
    }
    if (event.type === 'ascended') this.send('run', 'active', 'complete');

    if (event.type === 'bossStickerCollected') {
      this.startStickerPage();
      this.send('sticker', event.id, 'reached');
      if (event.pageComplete) {
        this.send('sticker-page', event.pageId, 'complete');
        this.stickerPageActive = false;
      }
    }
    if (event.type === 'dojoStyleUnlocked') this.send('dojo-style', event.id, 'visible');
    if (event.type === 'dojoStyleEquipped' && event.source === 'player') {
      this.send('dojo-style', event.id, 'interact');
    }

    if (event.type === 'powerupSpawned') this.send('powerup', event.id, 'visible');
    if (event.type === 'powerupCollected') {
      this.send('powerup', event.id, 'interact');
      if (event.id === 'coinFrenzy') this.send('powerup-challenge', 'coin-frenzy', 'start');
    }
    if (event.type === 'coinFrenzyFinished') this.send('powerup-challenge', 'coin-frenzy', 'complete');
    if (event.type === 'powerupCoachCompleted') {
      this.send('tutorial', 'powerup-context', 'complete');
      this.powerupLessonActive = false;
    }

    if (event.type === 'boardFull') this.send('friction', 'board-full', 'reached');
    if (event.type === 'purchaseRejected') {
      this.send('friction', event.reason === 'coins' ? 'buy-no-coins' : 'buy-board-full', 'reached');
    }

    if (!this.tutorialActive) return;
    if (event.type === 'ninjaSpawned' && purchases === 1 && this.tutorialStep === 'buy-1') {
      this.completeTutorialStep('buy-1', 'buy-2');
    } else if (event.type === 'ninjaSpawned' && purchases >= 2 && this.tutorialStep === 'buy-2') {
      this.completeTutorialStep('buy-2', 'merge');
    } else if (event.type === 'ninjaMerged' && this.tutorialStep === 'merge') {
      this.completeTutorialStep('merge', 'boss-tap');
    } else if (event.type === 'tutorialCompleted') {
      if (this.tutorialStep !== null) this.send('tutorial', this.tutorialStep, 'complete');
      this.send('tutorial', 'onboarding', 'complete');
      this.tutorialStep = null;
      this.tutorialActive = false;
    }
  }

  private startTutorialStep(step: TutorialCheckpoint): void {
    this.tutorialStep = step;
    this.send('tutorial', step, 'start');
  }

  private completeTutorialStep(step: TutorialCheckpoint, next: TutorialCheckpoint): void {
    this.send('tutorial', step, 'complete');
    this.startTutorialStep(next);
  }

  private send(category: string, what: string, action: string): void {
    const key = `${category}:${what}:${action}`;
    if (this.sent.has(key)) return;
    this.sent.add(key);
    this.report({ category, what, action });
  }

  private static readonly chapterStages = new Set([1, 10, 19, 28, 37, 50, 65, 82, 100]);
  private static readonly sessionSeconds = [30, 60, 90, 120, 180, 300] as const;
}
