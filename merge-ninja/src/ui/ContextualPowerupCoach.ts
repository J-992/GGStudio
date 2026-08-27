import Phaser from 'phaser';
import type { GameCore } from '../core/GameCore';
import type { GameEvent } from '../core/EventBus';
import { POWERUPS } from '../data/powerups';
import type { PowerupId } from '../data/powerups';
import { theme } from './theme';

const EFFECT_COPY: Readonly<Record<PowerupId, string>> = {
  shurikenFrenzy: 'TAP IT FOR DOUBLE DAMAGE',
  smokeBomb: 'TAP IT TO STOP BOSS ATTACKS',
  luckyCharm: 'TAP IT FOR DOUBLE COINS',
  protectiveWard: 'TAP IT TO BLOCK 3 HITS',
  coinFrenzy: 'TAP IT TO START COIN RAIN',
};

/**
 * Introduces powerups at the moment the first normal pickup enters the arena.
 * This lesson is separate from onboarding: it never delays the merge loop and
 * repeats on a later offer if the moving token leaves before it is caught.
 */
export class ContextualPowerupCoach extends Phaser.GameObjects.Container {
  private readonly card: Phaser.GameObjects.Container;
  private readonly title: Phaser.GameObjects.BitmapText;
  private readonly copy: Phaser.GameObjects.BitmapText;
  private readonly finger: Phaser.GameObjects.Image;
  private fingerTween: Phaser.Tweens.Tween | null = null;
  private activeId: PowerupId | null = null;

  constructor(
    private readonly sceneRef: Phaser.Scene,
    private readonly core: GameCore,
    private readonly anchor: (id: PowerupId) => Phaser.Math.Vector2 | null,
    private readonly onShown: () => void,
  ) {
    super(sceneRef, 0, 0);
    sceneRef.add.existing(this).setDepth(345).setVisible(false);

    const body = sceneRef.add.rectangle(0, 0, 560, 104, 0x20160e, 0.97).setStrokeStyle(5, 0x9df5cf);
    this.title = sceneRef.add.bitmapText(0, -22, 'pixel', 'POWER-UP!', 24).setOrigin(0.5).setTint(0xffe58a);
    this.copy = sceneRef.add.bitmapText(0, 24, 'pixel', '', 17).setOrigin(0.5).setTint(0xffffff);
    this.card = sceneRef.add.container(0, 0, [body, this.title, this.copy]);
    this.finger = sceneRef.add.image(0, 0, 'tutorial_hand').setOrigin(0.5, 1).setDisplaySize(92, 92);
    this.add([this.card, this.finger]);

    core.events.onAny((event) => this.onEvent(event));
  }

  get isActive(): boolean {
    return this.activeId !== null;
  }

  override update(): void {
    if (this.activeId === null) return;
    const target = this.anchor(this.activeId);
    if (target !== null) this.finger.setVisible(true).setPosition(target.x, target.y);
  }

  relayout(): void {
    if (this.activeId !== null) this.layoutPrompt();
  }

  private onEvent(event: GameEvent): void {
    if (event.type === 'powerupSpawned') {
      if (!this.core.tutorialCompleted || this.core.powerupCoachCompleted || this.activeId !== null) return;
      this.activeId = event.id;
      this.onShown();
      this.layoutPrompt();
      return;
    }
    if (event.type === 'powerupExpired' && event.id === this.activeId) {
      this.hidePrompt();
      return;
    }
    if (event.type !== 'powerupCollected' || event.id !== this.activeId) return;

    const id = this.activeId;
    this.activeId = null;
    this.fingerTween?.stop();
    this.fingerTween = null;
    this.finger.setVisible(false);
    this.title.setText(`${POWERUPS[id].label}!`);
    this.copy.setText('POWER-UP ACTIVE');
    this.sceneRef.time.delayedCall(1_400, () => this.setVisible(false));
    this.core.completePowerupCoach(id);
  }

  private layoutPrompt(): void {
    const id = this.activeId;
    if (id === null) return;
    this.setVisible(true);
    const viewportWidth = this.sceneRef.scale.gameSize.width;
    this.card.setScale(Math.min(1, Math.max(0.72, (viewportWidth - 32) / 560)));
    const arena = theme.layout.arena;
    this.card.setPosition(arena.x + arena.w / 2, arena.y + arena.h - 62);
    this.title.setText(POWERUPS[id].label);
    this.copy.setText(EFFECT_COPY[id]);

    const target = this.anchor(id);
    if (target === null) {
      this.finger.setVisible(false);
      return;
    }
    this.fingerTween?.stop();
    this.finger.setVisible(true).setPosition(target.x, target.y).setScale(1);
    this.fingerTween = this.sceneRef.tweens.add({
      targets: this.finger,
      y: target.y + 12,
      scale: 0.9,
      yoyo: true,
      repeat: -1,
      duration: 430,
      ease: 'Sine.easeInOut',
    });
  }

  private hidePrompt(): void {
    this.activeId = null;
    this.fingerTween?.stop();
    this.fingerTween = null;
    this.setVisible(false);
  }
}
