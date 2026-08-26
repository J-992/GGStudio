import type { GameEvent } from '../core/EventBus';

export interface RetentionMeasure {
  readonly category: string;
  readonly what: string;
  readonly action: string;
}

type RetentionSink = (measure: RetentionMeasure) => void;

/**
 * The deliberately small Poki funnel. It answers two questions without
 * drowning the dashboard in tap noise: where the first lesson loses players,
 * and which authored chapter they reached before leaving.
 */
export class RetentionFunnel {
  private readonly sent = new Set<string>();
  private tutorialActive = false;

  constructor(private readonly report: RetentionSink) {}

  startTutorial(): void {
    this.tutorialActive = true;
    this.send('tutorial', 'onboarding', 'start');
  }

  startStage(stage: number): void {
    const safeStage = Math.max(1, Math.floor(stage));
    if (RetentionFunnel.chapterStages.has(safeStage)) this.send('stage', String(safeStage), 'start');
  }

  handle(event: GameEvent, purchases: number): void {
    if (event.type === 'bossSpawned') this.startStage(event.stage);
    if (event.type === 'bossDefeated' && RetentionFunnel.chapterStages.has(event.stage)) {
      this.send('stage', String(event.stage), 'complete');
    }

    if (!this.tutorialActive) return;
    if (event.type === 'ninjaSpawned' && (purchases === 1 || purchases === 2)) {
      this.send('tutorial', `buy-${purchases}`, 'complete');
    } else if (event.type === 'ninjaMerged') {
      this.send('tutorial', 'merge', 'complete');
    } else if (event.type === 'powerupCollected' && event.id === 'coinFrenzy') {
      this.send('tutorial', 'coin-frenzy', 'interact');
    } else if (event.type === 'coinFrenzyFinished') {
      this.send('tutorial', 'coin-frenzy', 'complete');
    } else if (event.type === 'tutorialCompleted') {
      this.send('tutorial', 'onboarding', 'complete');
      this.tutorialActive = false;
    }
  }

  private send(category: string, what: string, action: string): void {
    const key = `${category}:${what}:${action}`;
    if (this.sent.has(key)) return;
    this.sent.add(key);
    this.report({ category, what, action });
  }

  private static readonly chapterStages = new Set([1, 10, 19, 28, 37, 50, 65, 82, 100]);
}
