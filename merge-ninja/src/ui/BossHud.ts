import Phaser from 'phaser';
import type { GameCore } from '../core/GameCore';
import type { GameEvent } from '../core/EventBus';
import { ATLAS_KEY } from '../render/atlasConfig';
import { compactNumber, theme } from './theme';
import type { DojoStyleDef } from '../data/dojoStyles';

/** Compact, measured HUD. Each label owns a separate row and backing plate. */
export class BossHud extends Phaser.GameObjects.Container {
  private readonly fill: Phaser.GameObjects.NineSlice;
  private readonly label: Phaser.GameObjects.BitmapText;
  private readonly stage: Phaser.GameObjects.BitmapText;
  private readonly bossName: Phaser.GameObjects.BitmapText;
  private readonly namePlate: Phaser.GameObjects.NineSlice;
  private readonly stagePlate: Phaser.GameObjects.NineSlice;
  private readonly barBack: Phaser.GameObjects.NineSlice;
  /** Briefly marks the exact HP slice removed by a player action. */
  private readonly tapDamageCut: Phaser.GameObjects.NineSlice;
  private shownHp = 1;
  private targetHp = 1;
  private maxHp = 1;
  private barWidth = 300;
  private tapColorStep = 0;

  constructor(private readonly sceneRef: Phaser.Scene, core: GameCore) {
    super(sceneRef, 0, 0); sceneRef.add.existing(this).setDepth(30);
    this.namePlate = sceneRef.add.nineslice(0, 0, ATLAS_KEY, 'banner_name_9', 80, 24, 11, 11, 7, 7);
    this.stagePlate = sceneRef.add.nineslice(0, 0, ATLAS_KEY, 'banner_name_9', 80, 24, 11, 11, 7, 7).setTint(0x6d91b8);
    this.stage = sceneRef.add.bitmapText(0, 0, 'pixel', '', 14).setOrigin(.5).setTint(0xffe58a);
    this.bossName = sceneRef.add.bitmapText(0, 0, 'pixel', '', 14).setOrigin(.5).setTint(0xffffff);
    this.barBack = sceneRef.add.nineslice(0, 0, ATLAS_KEY, 'panel_frame_9', this.barWidth, 24, 8, 8, 8, 8);
    this.fill = sceneRef.add.nineslice(0, 0, ATLAS_KEY, 'banner_name_9', this.barWidth - 8, 14, 11, 11, 7, 7).setOrigin(0, .5).setTint(0xc94e4a);
    this.tapDamageCut = sceneRef.add.nineslice(0, 0, ATLAS_KEY, 'banner_name_9', 1, 14, 11, 11, 7, 7).setOrigin(0, .5).setVisible(false);
    this.label = sceneRef.add.bitmapText(0, 0, 'pixel', '', 14).setOrigin(.5).setTint(0xffffff);
    this.add([this.namePlate, this.stagePlate, this.barBack, this.fill, this.tapDamageCut, this.bossName, this.stage, this.label]);
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
    this.tapDamageCut.setPosition(centre - this.barWidth / 2 + 4, top + 55);
    this.label.setPosition(centre, top + 55);
  }

  override update(): void {
    this.shownHp += (this.targetHp - this.shownHp) * .18;
    this.fill.setSize(Math.max(1, (this.barWidth - 8) * Math.max(0, this.shownHp / this.maxHp)), 14);
    this.label.setText(`${compactNumber(this.shownHp)} / ${compactNumber(this.maxHp)}`);
  }

  applyDojoStyle(style: DojoStyleDef): void {
    const crimson = style.id === 'crimson-dojo';
    this.namePlate.setTint(crimson ? style.palette.plate : 0xffffff);
    this.stagePlate.setTint(crimson ? style.palette.panel : 0x6d91b8);
    this.barBack.setTint(crimson ? style.palette.frame : 0xffffff);
    this.fill.setTint(crimson ? style.palette.vfx : 0xc94e4a);
    this.stage.setTint(crimson ? style.palette.accentBright : 0xffe58a);
  }

  private handle(event: GameEvent, core: GameCore): void {
    if (event.type === 'bossDamaged') {
      this.targetHp = event.hp; this.maxHp = event.maxHp;
      if (event.source === 'tap' || event.source === 'merge') {
        this.showPlayerDamageCut(event.damage, event.hp, event.maxHp, event.source);
      }
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

  /** Shows an active player hit as a coloured bite out of the current HP. */
  private showPlayerDamageCut(damage: number, hpAfter: number, maxHp: number, source: 'tap' | 'merge'): void {
    if (damage <= 0 || maxHp <= 0) return;
    this.sceneRef.tweens.killTweensOf(this.tapDamageCut);
    const usableWidth = this.barWidth - 8;
    const start = Math.max(0, Math.min(1, hpAfter / maxHp));
    const width = Math.max(2, Math.min(usableWidth * (1 - start), usableWidth * (damage / maxHp)));
    const left = theme.layout.arena.x + theme.layout.arena.w / 2 - this.barWidth / 2 + 4;
    // A new hue for each tap makes the cut read as player-caused instead of
    // blending into the boss's automatic red health loss.
    const color = source === 'merge'
      ? 0xffd35a
      : Phaser.Display.Color.HSVToRGB((this.tapColorStep * .11) % 1, .78, 1).color;
    if (source === 'tap') this.tapColorStep += 1;
    this.tapDamageCut
      .setPosition(left + usableWidth * start, this.tapDamageCut.y)
      .setSize(width, 14)
      .setTint(color)
      .setAlpha(1)
      .setVisible(true);
    this.sceneRef.tweens.add({
      targets: this.tapDamageCut,
      alpha: 0,
      duration: 420,
      ease: 'Quad.easeOut',
      onComplete: () => this.tapDamageCut.setVisible(false),
    });
  }
}
