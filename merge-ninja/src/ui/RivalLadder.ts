import Phaser from 'phaser';
import type { GameCore } from '../core/GameCore';
import { nextRivalIndex, rivalMilestone, upcomingRivals } from '../data/rivals';
import { ATLAS_KEY } from '../render/atlasConfig';
import { theme } from './theme';

type RivalRow = {
  readonly root: Phaser.GameObjects.Container;
  readonly plate: Phaser.GameObjects.Rectangle;
  readonly avatar: Phaser.GameObjects.Image;
  readonly name: Phaser.GameObjects.BitmapText;
  readonly score: Phaser.GameObjects.BitmapText;
};

/**
 * A compact, offline-safe social target: three named rival milestones ahead
 * of the player. It turns the stage counter into a clear "who can I beat
 * next?" goal without claiming a networked leaderboard exists.
 */
export class RivalLadder extends Phaser.GameObjects.Container {
  private readonly title: Phaser.GameObjects.BitmapText;
  private readonly distance: Phaser.GameObjects.BitmapText;
  private readonly rows: RivalRow[] = [];
  private readonly beat: Phaser.GameObjects.BitmapText;
  private nextIndex: number;

  constructor(private readonly sceneRef: Phaser.Scene, core: GameCore) {
    super(sceneRef, 0, 0);
    sceneRef.add.existing(this).setDepth(32);

    const backing = sceneRef.add.rectangle(0, 0, 188, 164, 0x171c25, 0.88).setStrokeStyle(2, 0x6d91b8, 0.85);
    this.title = sceneRef.add.bitmapText(0, -69, 'pixel', 'RIVAL LADDER', 14).setOrigin(0.5).setTint(0xffe58a);
    this.distance = sceneRef.add.bitmapText(0, 73, 'pixel', '', 11).setOrigin(0.5).setTint(0x9df5cf);
    this.beat = sceneRef.add.bitmapText(0, -69, 'pixel', '', 14).setOrigin(0.5).setTint(0xffe58a).setVisible(false);
    this.add([backing, this.title, this.distance, this.beat]);

    for (let index = 0; index < 3; index += 1) {
      const plate = sceneRef.add.rectangle(0, 0, 172, 34, 0x252d39, 0.92).setStrokeStyle(1, 0x526172, 0.75);
      const avatar = sceneRef.add.image(-68, 0, ATLAS_KEY, 'ninja_t1').setDisplaySize(30, 30);
      const name = sceneRef.add.bitmapText(-46, 0, 'pixel', '', 13).setOrigin(0, 0.5).setTint(0xf7f1df);
      const score = sceneRef.add.bitmapText(76, 0, 'pixel', '', 13).setOrigin(1, 0.5).setTint(0xbfdcff);
      const root = sceneRef.add.container(0, -35 + index * 36, [plate, avatar, name, score]);
      this.rows.push({ root, plate, avatar, name, score });
      this.add(root);
    }

    this.nextIndex = nextRivalIndex(core.boss.stage);
    this.refresh(core.boss.stage, false);
    core.events.on('bossSpawned', (event) => this.refresh(event.stage, true));
    this.relayout();
  }

  relayout(): void {
    const a = theme.layout.arena;
    const width = 188;
    this.setPosition(a.x + a.w - width / 2 - 7, a.y + 192);
    this.setScale(Math.min(1, Math.max(0.8, a.w / 520)));
  }

  /** Read-only hook for UI verification. */
  nextTargetStage(): number {
    return rivalMilestone(this.nextIndex).stage;
  }

  private refresh(stage: number, celebrate: boolean): void {
    const next = nextRivalIndex(stage);
    const previous = rivalMilestone(this.nextIndex);
    const beaten = celebrate && next > this.nextIndex;
    this.nextIndex = next;
    const rivals = upcomingRivals(stage, this.rows.length);

    rivals.forEach((rival, index) => {
      const row = this.rows[index]!;
      const isNext = index === 0;
      row.avatar.setFrame(`ninja_t${rival.avatarTier}`);
      row.name.setText(rival.name);
      row.score.setText(`S${rival.stage}`);
      row.plate.setFillStyle(isNext ? 0x344b63 : 0x252d39, isNext ? 0.98 : 0.92).setStrokeStyle(1, isNext ? 0xffd35a : 0x526172, isNext ? 1 : 0.75);
      row.name.setTint(isNext ? 0xfff1bd : 0xf7f1df);
      row.score.setTint(isNext ? 0x9df5cf : 0xbfdcff);
      row.root.setScale(1);
    });

    const target = rivals[0]!;
    const away = Math.max(1, target.stage - Math.max(1, Math.floor(stage)));
    this.distance.setText(`${away} STAGE${away === 1 ? '' : 'S'} TO BEAT ${target.name}`);

    if (!beaten) return;
    this.rows[0]!.root.setScale(0.86);
    this.sceneRef.tweens.add({ targets: this.rows[0]!.root, scale: 1, duration: 300, ease: 'Back.easeOut' });
    this.title.setVisible(false);
    this.beat.setText(`YOU BEAT ${previous.name}!`).setAlpha(0).setVisible(true);
    this.sceneRef.tweens.add({
      targets: this.beat,
      alpha: { from: 0, to: 1 },
      y: { from: -65, to: -69 },
      duration: 220,
      ease: 'Back.easeOut',
    });
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
