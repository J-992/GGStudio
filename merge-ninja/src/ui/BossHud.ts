import Phaser from 'phaser';
import type { GameCore } from '../core/GameCore';
import type { GameEvent } from '../core/EventBus';
import { ATLAS_KEY } from '../render/atlasConfig';
import { compactNumber, theme } from './theme';

/** Compact, measured HUD. Each label owns a separate row and backing plate. */
export class BossHud extends Phaser.GameObjects.Container {
  private readonly fill: Phaser.GameObjects.NineSlice;
  private readonly label: Phaser.GameObjects.BitmapText;
  private readonly stage: Phaser.GameObjects.BitmapText;
  private readonly bossName: Phaser.GameObjects.BitmapText;
  private readonly namePlate: Phaser.GameObjects.NineSlice;
  private readonly stagePlate: Phaser.GameObjects.NineSlice;
  private readonly barBack: Phaser.GameObjects.NineSlice;
  private shownHp = 1;
  private targetHp = 1;
  private maxHp = 1;
  private barWidth = 300;

  constructor(private readonly sceneRef: Phaser.Scene, core: GameCore) {
    super(sceneRef, 0, 0); sceneRef.add.existing(this).setDepth(30);
    this.namePlate = sceneRef.add.nineslice(0, 0, ATLAS_KEY, 'banner_name_9', 80, 24, 11, 11, 7, 7);
    this.stagePlate = sceneRef.add.nineslice(0, 0, ATLAS_KEY, 'banner_name_9', 80, 24, 11, 11, 7, 7).setTint(0x6d91b8);
    this.stage = sceneRef.add.bitmapText(0, 0, 'pixel', '', 14).setOrigin(.5).setTint(0xffe58a);
    this.bossName = sceneRef.add.bitmapText(0, 0, 'pixel', '', 14).setOrigin(.5).setTint(0xffffff);
    this.barBack = sceneRef.add.nineslice(0, 0, ATLAS_KEY, 'panel_frame_9', this.barWidth, 24, 8, 8, 8, 8);
    this.fill = sceneRef.add.nineslice(0, 0, ATLAS_KEY, 'banner_name_9', this.barWidth - 8, 14, 11, 11, 7, 7).setOrigin(0, .5).setTint(0xc94e4a);
    this.label = sceneRef.add.bitmapText(0, 0, 'pixel', '', 14).setOrigin(.5).setTint(0xffffff);
    this.add([this.namePlate, this.stagePlate, this.barBack, this.fill, this.bossName, this.stage, this.label]);
    core.events.onAny((event) => this.handle(event, core));
    this.setBoss(core);
  }

  relayout(): void {
    const a = theme.layout.arena;
    const centre = a.x + a.w / 2;
    const top = a.y + 27;
    const maxWidth = Math.max(150, a.w - 80);
    const nameWidth = Math.min(maxWidth, Math.ceil(this.bossName.width) + 30);
    const stageWidth = Math.min(maxWidth, Math.ceil(this.stage.width) + 30);
    this.barWidth = Math.min(280, Math.max(156, a.w - 150));
    this.stagePlate.setPosition(centre, top).setSize(stageWidth, 24);
    this.stage.setPosition(centre, top);
    this.namePlate.setPosition(centre, top + 28).setSize(nameWidth, 24);
    this.bossName.setPosition(centre, top + 28);
    this.barBack.setPosition(centre, top + 55).setSize(this.barWidth, 24);
    this.fill.setPosition(centre - this.barWidth / 2 + 4, top + 55).setSize(Math.max(1, this.barWidth - 8), 14);
    this.label.setPosition(centre, top + 55);
  }

  override update(): void {
    this.shownHp += (this.targetHp - this.shownHp) * .18;
    this.fill.setSize(Math.max(1, (this.barWidth - 8) * Math.max(0, this.shownHp / this.maxHp)), 14);
    this.label.setText(`${compactNumber(this.shownHp)} / ${compactNumber(this.maxHp)}`);
  }

  private handle(event: GameEvent, core: GameCore): void {
    if (event.type === 'bossDamaged') {
      this.targetHp = event.hp; this.maxHp = event.maxHp;
      if (event.maxHp > 0 && event.dps / event.maxHp > .08) this.sceneRef.tweens.add({ targets: this.fill, alpha: .25, yoyo: true, repeat: 2, duration: 65 });
    }
    if (event.type === 'bossDefeated') this.sceneRef.tweens.add({ targets: this, alpha: .25, duration: 160, yoyo: true });
    if (event.type === 'bossSpawned') this.setBoss(core);
  }

  private setBoss(core: GameCore): void {
    const boss = core.boss.boss;
    this.maxHp = boss.maxHealth; this.targetHp = core.boss.hp; this.shownHp = this.targetHp;
    this.fill.setAlpha(1); this.stage.setText(`STAGE ${boss.stage}`); this.bossName.setText(boss.name.toUpperCase());
    this.relayout();
  }
}
