import Phaser from 'phaser';
import type { GameCore } from '../core/GameCore';
import { nextRivalIndex, rivalMilestone } from '../data/rivals';
import { ATLAS_KEY } from '../render/atlasConfig';
import { theme } from './theme';

const PANEL_WIDTH = 330;
const TRACK_WIDTH = 202;

/** One readable target, modelled after an endless-runner friend marker. */
export class RivalLadder extends Phaser.GameObjects.Container {
  private readonly title: Phaser.GameObjects.BitmapText;
  private readonly rivalName: Phaser.GameObjects.BitmapText;
  private readonly stageText: Phaser.GameObjects.BitmapText;
  private readonly distance: Phaser.GameObjects.BitmapText;
  private readonly trackFill: Phaser.GameObjects.Rectangle;
  private readonly playerDot: Phaser.GameObjects.Arc;
  private readonly avatar: Phaser.GameObjects.Image;
  private readonly beat: Phaser.GameObjects.BitmapText;
  private nextIndex: number;

  constructor(private readonly sceneRef: Phaser.Scene, core: GameCore) {
    super(sceneRef, 0, 0);
    sceneRef.add.existing(this).setDepth(32);

    const backing = sceneRef.add.rectangle(0, 0, PANEL_WIDTH, 118, 0x171c25, 0.92).setStrokeStyle(3, 0xffd35a, 0.9);
    const avatarPlate = sceneRef.add.circle(126, -3, 40, 0x344b63, 1).setStrokeStyle(3, 0xffd35a, 1);
    const trackBack = sceneRef.add.rectangle(-34, 17, TRACK_WIDTH, 14, 0x0c1118, 1).setStrokeStyle(2, 0x526172, 1);
    this.trackFill = sceneRef.add.rectangle(-135, 17, 1, 10, 0x66e6a8, 1).setOrigin(0, 0.5);
    this.playerDot = sceneRef.add.circle(-135, 17, 8, 0xfff1bd, 1).setStrokeStyle(2, 0x1b2430, 1);
    this.title = sceneRef.add.bitmapText(-148, -43, 'pixel', 'NEXT RIVAL', 18).setOrigin(0, 0.5).setTint(0xffe58a);
    this.rivalName = sceneRef.add.bitmapText(-148, -15, 'pixel', '', 22).setOrigin(0, 0.5).setTint(0xffffff);
    this.stageText = sceneRef.add.bitmapText(78, -32, 'pixel', '', 17).setOrigin(1, 0.5).setTint(0x9df5cf);
    this.distance = sceneRef.add.bitmapText(-34, 44, 'pixel', '', 16).setOrigin(0.5).setTint(0xbfdcff);
    this.avatar = sceneRef.add.image(126, -3, ATLAS_KEY, 'ninja_t1').setDisplaySize(70, 70);
    this.beat = sceneRef.add.bitmapText(0, -43, 'pixel', '', 20).setOrigin(0.5).setTint(0xfff1bd).setVisible(false);
    this.add([
      backing,
      avatarPlate,
      trackBack,
      this.trackFill,
      this.playerDot,
      this.title,
      this.rivalName,
      this.stageText,
      this.distance,
      this.avatar,
      this.beat,
    ]);

    this.nextIndex = nextRivalIndex(core.boss.stage);
    this.refresh(core.boss.stage, false);
    core.events.on('bossSpawned', (event) => this.refresh(event.stage, true));
    this.relayout();
  }

  relayout(): void {
    const a = theme.layout.arena;
    this.setPosition(a.x + a.w - PANEL_WIDTH / 2 - 8, a.y + 214);
    this.setScale(Math.min(1, Math.max(0.82, a.w / 684)));
  }

  /** Read-only hook for UI verification. */
  nextTargetStage(): number {
    return rivalMilestone(this.nextIndex).stage;
  }

  private refresh(stage: number, celebrate: boolean): void {
    const safeStage = Math.max(1, Math.floor(stage));
    const next = nextRivalIndex(safeStage);
    const beatenRival = rivalMilestone(this.nextIndex);
    const beaten = celebrate && next > this.nextIndex;
    this.nextIndex = next;

    const target = rivalMilestone(next);
    const previousStage = next === 0 ? 1 : rivalMilestone(next - 1).stage;
    const progress = Phaser.Math.Clamp((safeStage - previousStage) / Math.max(1, target.stage - previousStage), 0, 1);
    const fillWidth = Math.max(1, TRACK_WIDTH * progress);
    const away = Math.max(1, target.stage - safeStage);

    this.avatar.setFrame(`ninja_t${target.avatarTier}`);
    this.rivalName.setText(target.name);
    this.stageText.setText(`STAGE ${target.stage}`);
    this.distance.setText(`${away} STAGE${away === 1 ? '' : 'S'} LEFT`);
    this.trackFill.setSize(fillWidth, 10);
    this.playerDot.setX(-135 + fillWidth);

    if (!beaten) return;
    this.title.setVisible(false);
    this.beat.setText(`YOU PASSED ${beatenRival.name}!`).setAlpha(0).setVisible(true);
    this.sceneRef.tweens.add({
      targets: this.beat,
      alpha: { from: 0, to: 1 },
      scale: { from: 0.8, to: 1 },
      duration: 260,
      ease: 'Back.easeOut',
    });
    this.sceneRef.tweens.add({ targets: this.avatar, scale: { from: 0.72, to: 1 }, duration: 330, ease: 'Back.easeOut' });
    this.sceneRef.time.delayedCall(1_250, () => {
      this.sceneRef.tweens.add({
        targets: this.beat,
        alpha: 0,
        duration: 180,
        onComplete: () => {
          this.beat.setVisible(false);
          this.title.setVisible(true);
        },
      });
    });
  }
}
