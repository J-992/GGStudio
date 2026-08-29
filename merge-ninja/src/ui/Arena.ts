import Phaser from 'phaser';
import type { GameCore } from '../core/GameCore';
import type { GameEvent } from '../core/EventBus';
import { ninjaDef } from '../data/ninjas';
import { HealthBar } from './HealthBar';
import { theme } from './theme';
import type { Fx } from '../effects/Fx';
import type { Sfx } from '../audio/Sfx';
/** Legacy compatibility view; the live scene uses ArenaManager and BossHud. */
export class Arena extends Phaser.GameObjects.Container {
  private readonly enemy: Phaser.GameObjects.Image; private readonly champion: Phaser.GameObjects.Image; private readonly enemyHp: HealthBar; private readonly stage: Phaser.GameObjects.BitmapText; private readonly enemyName: Phaser.GameObjects.BitmapText; private readonly buyPrompt: Phaser.GameObjects.BitmapText; private activeBanner: Phaser.GameObjects.Container | null = null;
  constructor(scene: Phaser.Scene, private readonly core: GameCore, private readonly fx: Fx, private readonly sfx: Sfx) { super(scene, 0, 0); scene.add.existing(this); this.add(this.makeScenery(scene)); this.stage = new Phaser.GameObjects.BitmapText(scene, 360, 25, 'pixel', '', 14).setOrigin(.5).setTint(0x2b2118); this.enemyName = new Phaser.GameObjects.BitmapText(scene, 360, 60, 'pixel', '', 14).setOrigin(.5).setTint(0x2b2118); this.enemy = new Phaser.GameObjects.Image(scene, theme.layout.enemy.x, theme.layout.enemy.y, core.boss.boss.textureKey, 0); this.champion = new Phaser.GameObjects.Image(scene, theme.layout.champion.x, theme.layout.champion.y, ninjaDef(1).textureKey, 0).setVisible(false); this.enemyHp = new HealthBar(scene, 360, theme.layout.enemyHpY, 270, theme.colors.enemyHealth); this.buyPrompt = new Phaser.GameObjects.BitmapText(scene, 360, theme.layout.promptY, 'pixel', 'BUY A NINJA!\nV', 14).setOrigin(.5).setTint(0xffffff).setVisible(false); this.add([this.stage, this.enemyName, this.enemy, this.champion, this.enemyHp, this.buyPrompt]); core.events.onAny((e) => this.handle(e)); this.syncFromCore(); }
  private makeScenery(scene: Phaser.Scene): Phaser.GameObjects.Graphics {
    const a = theme.layout.arena;
    const scenery = new Phaser.GameObjects.Graphics(scene);
    scenery.fillGradientStyle(theme.colors.skyTop, theme.colors.skyTop, theme.colors.skyHorizon, theme.colors.skyHorizon, 1);
    scenery.fillRect(a.x, a.y, a.w, a.h);
    scenery.fillStyle(theme.colors.groundEarth).fillRect(0, 480, a.w, 80);
    scenery.fillStyle(theme.colors.groundShade).fillRect(0, 538, a.w, 22);
    scenery.lineStyle(7, theme.colors.matBorder).fillStyle(theme.colors.matStraw).fillEllipse(360, 385, 510, 290).strokeEllipse(360, 385, 510, 290);
    [24, 76, 644, 696].forEach((x, index) => {
      const top = index % 2 === 0 ? 142 : 222;
      scenery.fillStyle(theme.colors.bambooDark).fillRect(x - 8, top, 16, 338);
      scenery.lineStyle(3, theme.colors.matBorder);
      for (let y = top + 42; y < 470; y += 48) scenery.lineBetween(x - 8, y, x + 8, y);
      scenery.fillStyle(theme.colors.bambooLight);
      const side = x < 100 ? 1 : -1;
      scenery.fillTriangle(x, top + 90, x + side * 44, top + 64, x + side * 30, top + 104);
      scenery.fillTriangle(x, top + 180, x + side * 40, top + 150, x + side * 25, top + 195);
    });
    [145, 575].forEach((x) => {
      scenery.fillStyle(theme.colors.bannerRed).fillRect(x - 52, 0, 104, 86);
      scenery.fillStyle(theme.colors.bannerDark).fillTriangle(x - 52, 86, x + 52, 86, x, 112);
      scenery.lineStyle(4, theme.colors.bannerDark).strokeRect(x - 52, 0, 104, 86);
    });
    return scenery;
  }
  private handle(e: GameEvent): void { if (e.type === 'stateLoaded') this.syncFromCore(); if (e.type === 'bossSpawned') this.refreshEnemy(); if (e.type === 'championChanged') this.refreshChampion(); if (e.type === 'bossDamaged') this.bossDamaged(e.dps); if (e.type === 'bossAttack') this.bossAttack(); if (e.type === 'bossDefeated') { this.poof(this.enemy); this.fx.defeat(this.enemy.x, this.enemy.y, true); this.fx.coins(this.enemy.x, this.enemy.y, 16); this.sfx.play('bossDefeat'); this.fx.shake(.012, 220); this.banner('VICTORY!'); } if (e.type === 'newTierDiscovered') { this.banner(`NEW NINJA!\n${e.name.toUpperCase()}`); this.sfx.play('newTier', e.tier); } }
  syncFromCore(): void { this.refreshEnemy(false); this.refreshChampion(); }
  private refreshEnemy(animate = true): void { const boss = this.core.boss.boss; this.enemy.setTexture(boss.textureKey).setScale(theme.layout.charScale * boss.scale).setPosition(theme.layout.enemy.x, theme.layout.enemy.y).setAlpha(1); this.enemyName.setText(boss.name.toUpperCase()); this.stage.setText(`STAGE ${boss.stage} - BOSS`); this.enemyHp.setValue(this.core.boss.hp, boss.maxHealth); if (animate) this.scene.tweens.add({ targets: this.enemy, alpha: { from: 0, to: 1 }, duration: 550 }); }
  private refreshChampion(): void { const tier = this.core.highestTier; if (tier <= 0) { this.champion.setVisible(false); this.buyPrompt.setVisible(true); return; } const ninja = ninjaDef(tier); this.champion.setTexture(ninja.textureKey).setScale(theme.layout.charScale).setPosition(theme.layout.champion.x, theme.layout.champion.y).setVisible(true).setAlpha(1); this.buyPrompt.setVisible(false); }
  private bossDamaged(dps: number): void { this.scene.tweens.add({ targets: this.enemy, x: theme.layout.enemy.x + 12, yoyo: true, duration: 90 }); this.fx.hit(this.enemy.x, theme.layout.damageY.enemy, Math.max(1, Math.round(dps / 10)), theme.colors.health, this.enemy, false); this.enemyHp.setValue(this.core.boss.hp, this.core.boss.boss.maxHealth); this.sfx.play('hit'); }
  private bossAttack(): void { this.scene.tweens.add({ targets: this.enemy, y: theme.layout.enemy.y + 26, yoyo: true, duration: 180 }); this.scene.tweens.add({ targets: this.champion, x: theme.layout.champion.x - 20, yoyo: true, duration: 120 }); }
  private poof(target: Phaser.GameObjects.Image): void { this.scene.tweens.add({ targets: target, alpha: 0, scale: target.scaleX * 1.25, duration: 250 }); }
  /**
   * Transient arena banner ("NEW NINJA!", "Train More!", "VICTORY!").
   *
   * It sits on a dark strip: the arena's vertical bands are packed tight, so
   * bare text landed on top of the champion's health bar and became unreadable.
   * The strip makes the overlap read as a deliberate overlay, and everything
   * fades on its own so the player can keep dragging straight through it.
   */
  private banner(text: string): void {
    const y = theme.layout.bannerY;

    // Only one banner at a time. A defeat and a new-tier reveal can land in the
    // same instant, and stacking them rendered two messages on top of each other.
    this.activeBanner?.destroy();

    const strip = new Phaser.GameObjects.Rectangle(
      this.scene,
      0,
      0,
      theme.layout.width,
      104,
      theme.colors.shadow,
      0.85,
    );
    const label = new Phaser.GameObjects.BitmapText(this.scene, 0, 0, 'pixel', text, 14)
      .setOrigin(0.5)
      .setTint(0xffffff);

    const banner = this.scene.add.container(360, y, [strip, label]).setDepth(40);
    this.activeBanner = banner;

    this.scene.tweens.add({
      targets: banner,
      alpha: 0,
      y: y - 28,
      duration: 700,
      delay: 350,
      onComplete: () => {
        if (this.activeBanner === banner) this.activeBanner = null;
        banner.destroy();
      },
    });
  }
}
