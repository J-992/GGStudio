import Phaser from 'phaser';
import type { GameCore } from '../core/GameCore';
import type { GameEvent } from '../core/EventBus';
import { ATLAS_KEY } from '../render/atlasConfig';
import { compactNumber, theme } from './theme';
import type { DojoStyleDef } from '../data/dojoStyles';

/**
 * The dojo's shared durability bar. It gives every boss swing a readable
 * consequence while staying distinct from any individual unit on the board.
 */
export class PlayerHud extends Phaser.GameObjects.Container {
  private readonly namePlate: Phaser.GameObjects.NineSlice;
  private readonly barBack: Phaser.GameObjects.NineSlice;
  private readonly fill: Phaser.GameObjects.NineSlice;
  private readonly nameText: Phaser.GameObjects.BitmapText;
  private readonly value: Phaser.GameObjects.BitmapText;
  private readonly tempo: Phaser.GameObjects.BitmapText;
  private shownHp = 1;
  private targetHp = 1;
  private maxHp = 1;
  private barWidth = 164;

  constructor(private readonly sceneRef: Phaser.Scene, core: GameCore) {
    super(sceneRef, 0, 0);
    sceneRef.add.existing(this).setDepth(31);
    this.namePlate = sceneRef.add.nineslice(0, 0, ATLAS_KEY, 'banner_name_9', 100, 18, 11, 11, 7, 7).setTint(0x355843);
    this.barBack = sceneRef.add.nineslice(0, 0, ATLAS_KEY, 'panel_frame_9', this.barWidth, 20, 8, 8, 8, 8);
    this.fill = sceneRef.add.nineslice(0, 0, ATLAS_KEY, 'banner_name_9', this.barWidth - 8, 12, 11, 11, 7, 7).setOrigin(0, .5);
    this.nameText = sceneRef.add.bitmapText(0, 0, 'pixel', 'NINJA LINE', 12).setOrigin(.5).setTint(0xeaf7e5);
    this.value = sceneRef.add.bitmapText(0, 0, 'pixel', '', 11).setOrigin(.5).setTint(0xf7ead1);
    this.tempo = sceneRef.add.bitmapText(0, 0, 'pixel', '', 11).setOrigin(0, .5).setTint(0xffdf82);
    this.add([this.namePlate, this.barBack, this.fill, this.nameText, this.value, this.tempo]);
    this.setHealth(core.playerHealth, core.playerMaxHealth, false);
    this.tempo.setText(core.tempo.label);
    core.events.onAny((event) => this.handle(event));
    this.relayout();
  }

  relayout(): void {
    const a = theme.layout.arena;
    this.barWidth = theme.layout.landscape ? 146 : 158;
    const left = a.x + 28;
    const y = a.y + 86;
    this.namePlate.setPosition(left + 50, y).setSize(100, 18);
    this.nameText.setPosition(left + 50, y);
    this.barBack.setPosition(left + this.barWidth / 2, y + 19).setSize(this.barWidth, 17);
    this.fill.setPosition(left + 4, y + 19).setSize(Math.max(1, this.barWidth - 8), 9);
    this.value.setPosition(left + this.barWidth / 2, y + 19);
    this.tempo.setPosition(left + this.barWidth + 9, y + 19);
  }

  override update(): void {
    this.shownHp += (this.targetHp - this.shownHp) * .22;
    const ratio = Math.max(0, Math.min(1, this.shownHp / this.maxHp));
    this.fill.setSize(Math.max(1, (this.barWidth - 8) * ratio), 9).setTint(this.healthColor(ratio));
    this.value.setText(`${compactNumber(this.shownHp)} / ${compactNumber(this.maxHp)}`);
  }

  applyDojoStyle(style: DojoStyleDef): void {
    this.namePlate.setTint(style.id === 'crimson-dojo' ? style.palette.panel : 0x355843);
    this.barBack.setTint(style.palette.frame);
    this.nameText.setTint(style.id === 'crimson-dojo' ? 0xfff1c2 : 0xeaf7e5);
    this.tempo.setTint(style.palette.accentBright);
  }

  private handle(event: GameEvent): void {
    if (event.type === 'playerHealthChanged') {
      this.setHealth(event.hp, event.maxHp, true);
      if (event.delta < 0) this.flashHit();
    }
    if (event.type === 'bossAttack' && event.damage > 0) this.flashHit();
    if (event.type === 'gameOver') {
      this.sceneRef.tweens.add({ targets: this, alpha: .22, duration: 90, yoyo: true, repeat: 2 });
    }
    if (event.type === 'tempoChanged') this.tempo.setText(event.label);
  }

  private setHealth(hp: number, maxHp: number, animate: boolean): void {
    this.maxHp = Math.max(1, maxHp);
    this.targetHp = Math.max(0, Math.min(this.maxHp, hp));
    if (!animate) this.shownHp = this.targetHp;
  }

  private flashHit(): void {
    this.sceneRef.tweens.add({ targets: this.fill, alpha: .18, yoyo: true, repeat: 1, duration: 70 });
  }

  private healthColor(ratio: number): number {
    if (ratio < .3) return 0xd84e49;
    if (ratio < .58) return 0xe6a63c;
    return 0x5fbf61;
  }
}
