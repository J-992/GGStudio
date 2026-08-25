import Phaser from 'phaser';
import type { GameCore } from '../core/GameCore';
import type { GameEvent } from '../core/EventBus';
import type { PowerupId } from '../data/powerups';
import { theme } from './theme';

type TutorialStep = 'buyFirst' | 'buySecond' | 'merge' | 'powerup' | 'bossTap' | 'complete';

type TutorialAnchors = {
  buy: () => Phaser.Math.Vector2;
  ninja: (slot: number) => Phaser.Math.Vector2;
  powerup: (id: PowerupId) => Phaser.Math.Vector2 | null;
  boss: () => Phaser.Math.Vector2;
};

/**
 * A deliberately tiny, non-blocking coach for a player's very first run.
 * It never intercepts input: the finger points at the next action and the
 * game remains fully playable underneath it.
 */
export class FirstRunTutorial extends Phaser.GameObjects.Container {
  private readonly card: Phaser.GameObjects.Container;
  private readonly title: Phaser.GameObjects.BitmapText;
  private readonly copy: Phaser.GameObjects.BitmapText;
  private readonly progress: Phaser.GameObjects.BitmapText;
  private readonly finger: Phaser.GameObjects.Image;
  private fingerTween: Phaser.Tweens.Tween | null = null;
  private activePowerup: PowerupId | null = null;
  private step: TutorialStep;

  constructor(
    private readonly sceneRef: Phaser.Scene,
    private readonly core: GameCore,
    private readonly anchors: TutorialAnchors,
  ) {
    super(sceneRef, 0, 0);
    sceneRef.add.existing(this).setDepth(340);

    const cardBody = sceneRef.add.rectangle(0, 0, 382, 78, 0x20160e, 0.96).setStrokeStyle(3, 0xffd35a);
    this.progress = sceneRef.add.bitmapText(-166, -29, 'pixel', '', 10).setOrigin(0, 0.5).setTint(0x9df5cf);
    this.title = sceneRef.add.bitmapText(0, -13, 'pixel', '', 14).setOrigin(0.5).setTint(0xffe58a);
    this.copy = sceneRef.add.bitmapText(0, 16, 'pixel', '', 11).setOrigin(0.5).setCenterAlign().setTint(0xffffff);
    this.card = sceneRef.add.container(0, 0, [cardBody, this.progress, this.title, this.copy]);

    // The origin is the fingertip: all three tutorial prompts can aim at the
    // actual touch target without bespoke offsets for this richer sprite.
    this.finger = sceneRef.add.image(0, 0, 'tutorial_hand').setOrigin(0.5, 1).setDisplaySize(92, 92);
    this.add([this.card, this.finger]);

    this.step = this.initialStep();
    this.applyStep();
    core.events.onAny((event) => this.onEvent(event));
  }

  get isActive(): boolean {
    return this.step !== 'complete';
  }

  override update(): void {
    if (this.step === 'powerup' && this.activePowerup !== null) {
      const target = this.anchors.powerup(this.activePowerup);
      if (target !== null) this.finger.setPosition(target.x, target.y);
    }
    if (this.step === 'bossTap') {
      const target = this.anchors.boss();
      this.finger.setPosition(target.x, target.y);
    }
  }

  relayout(): void {
    this.applyStep();
  }

  private initialStep(): TutorialStep {
    if (this.core.tutorialCompleted) return 'complete';
    if (this.core.metrics.purchases === 0) return 'buyFirst';
    if (this.core.metrics.purchases === 1) return 'buySecond';
    return this.core.metrics.merges === 0 ? 'merge' : 'powerup';
  }

  private onEvent(event: GameEvent): void {
    if (!this.isActive) return;
    if (event.type === 'ninjaSpawned') {
      if (this.core.metrics.purchases === 1) this.setStep('buySecond');
      else if (this.core.metrics.purchases >= 2 && this.core.metrics.merges === 0) this.setStep('merge');
    } else if (event.type === 'ninjaMerged' && this.step === 'merge') {
      this.setStep('powerup');
    } else if (event.type === 'powerupSpawned' && this.step === 'powerup') {
      this.activePowerup = event.id;
      this.applyStep();
    } else if (event.type === 'powerupCollected' && this.step === 'powerup' && event.id === this.activePowerup) {
      this.setStep('bossTap');
    } else if (event.type === 'bossDamaged' && this.step === 'bossTap' && event.source === 'tap') {
      this.core.completeTutorial();
      this.setStep('complete');
    }
  }

  private setStep(step: TutorialStep): void {
    if (this.step === step) return;
    this.step = step;
    this.activePowerup = null;
    this.applyStep();
  }

  private applyStep(): void {
    this.fingerTween?.stop();
    this.fingerTween = null;
    if (this.step === 'complete') {
      this.setVisible(true);
      this.progress.setText('NEW GOAL UNLOCKED');
      this.title.setText('WORLD RECORD: STAGE 100');
      this.copy.setText('CAN YOU BEAT IT?');
      this.finger.setVisible(false);
      const a = theme.layout.arena;
      this.card.setPosition(a.x + a.w / 2, a.y + 65);
      this.sceneRef.tweens.add({ targets: this.card, scale: { from: 0.9, to: 1 }, alpha: { from: 0, to: 1 }, duration: 260, ease: 'Back.Out' });
      this.sceneRef.time.delayedCall(2800, () => this.setVisible(false));
      return;
    }
    this.setVisible(true);
    // Keep the coach readable on narrow portrait canvases without shrinking
    // the target hand (which should remain easy to see and tap around).
    const viewportWidth = this.sceneRef.scale.gameSize.width;
    this.card.setScale(Math.min(1, Math.max(0.72, (viewportWidth - 24) / 382)));

    if (this.step === 'buyFirst' || this.step === 'buySecond') {
      this.progress.setText('1 / 4   BUILD YOUR TEAM');
      this.title.setText(this.step === 'buyFirst' ? 'YOUR FIRST NINJA' : 'GET A MATCH');
      this.copy.setText(this.step === 'buyFirst' ? 'TAP BUY TO RECRUIT A NINJA' : 'TAP BUY ONE MORE TIME');
      const buy = this.anchors.buy();
      // Keep the whole hand below the message, rather than hiding either one
      // behind the other. Its fingertip still lands exactly on BUY.
      this.card.setPosition(buy.x, buy.y - 190);
      this.pulseFinger(buy.x, buy.y);
      return;
    }

    if (this.step === 'merge') {
      this.progress.setText('2 / 4   MERGE');
      this.title.setText('MAKE A STRONGER NINJA');
      this.copy.setText('DRAG ONE MATCHING NINJA ONTO THE OTHER');
      const b = theme.layout.board;
      // The drag begins inside the roster; park the instruction just above it
      // so the animated hand has its own clear side of the banner.
      this.card.setPosition(b.x + b.w / 2, b.y - 26);
      const pair = this.firstPair();
      if (pair !== null) this.dragFinger(pair.from, pair.to);
      return;
    }

    if (this.step === 'powerup') {
      this.progress.setText('3 / 4   POWER-UP');
      this.title.setText(this.activePowerup === null ? 'POWER-UPS ARE COMING' : 'POWER-UP!');
      this.copy.setText(this.activePowerup === null ? 'WATCH FOR THE GLOW' : 'TAP THE GLOWING POWER-UP');
      const a = theme.layout.arena;
      // Powerups travel through the arena's upper/middle lanes, so the card
      // sits below them and never masks the finger's tap target.
      this.card.setPosition(a.x + a.w / 2, a.y + a.h - 62);
      if (this.activePowerup !== null) {
        const target = this.anchors.powerup(this.activePowerup);
        if (target !== null) this.pulseFinger(target.x, target.y);
        else this.finger.setVisible(false);
      } else {
        this.finger.setVisible(false);
      }
      return;
    }

    this.progress.setText('4 / 4   JOIN THE FIGHT');
    this.title.setText('BUILD A STREAK');
    this.copy.setText('TAP THE BOSS TO START A STREAK');
    const a = theme.layout.arena;
    this.card.setPosition(a.x + a.w / 2, a.y + a.h - 62);
    const target = this.anchors.boss();
    this.pulseFinger(target.x, target.y);
  }

  private firstPair(): { from: Phaser.Math.Vector2; to: Phaser.Math.Vector2 } | null {
    const pair = this.core.board.mergePair();
    if (pair === null) return null;
    return { from: this.anchors.ninja(pair[0]), to: this.anchors.ninja(pair[1]) };
  }

  private pulseFinger(x: number, y: number): void {
    this.finger.setVisible(true).setPosition(x, y).setScale(1);
    this.fingerTween = this.sceneRef.tweens.add({
      targets: this.finger,
      y: y + 12,
      scale: 0.9,
      yoyo: true,
      repeat: -1,
      duration: 430,
      ease: 'Sine.easeInOut',
    });
  }

  private dragFinger(from: Phaser.Math.Vector2, to: Phaser.Math.Vector2): void {
    this.finger.setVisible(true).setPosition(from.x, from.y).setScale(1);
    this.fingerTween = this.sceneRef.tweens.add({
      targets: this.finger,
      x: { from: from.x, to: to.x },
      y: { from: from.y, to: to.y },
      scale: { from: 1, to: 0.9 },
      duration: 900,
      hold: 280,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }
}
