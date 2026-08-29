import Phaser from 'phaser';
import { VFX_ANIMATIONS, type VfxAnimationId } from '../data/vfxAssets';

/** Combat presentation built from bounded animated sprite pools. */
export class CombatFX {
  private readonly damagePool: Phaser.GameObjects.BitmapText[] = [];
  private readonly gainPool: Phaser.GameObjects.BitmapText[] = [];
  private readonly impactPool: Phaser.GameObjects.Sprite[] = [];
  private readonly slashPool: Phaser.GameObjects.Sprite[] = [];
  private impactCursor = 0;
  private slashCursor = 0;

  constructor(private readonly scene: Phaser.Scene) {
    for (let i = 0; i < 12; i += 1) {
      this.damagePool.push(
        scene.add
          .bitmapText(0, 0, 'pixel', '', 14)
          .setScale(2)
          .setTint(0xfff1a2)
          .setOrigin(0.5)
          .setDepth(33)
          .setVisible(false),
      );
    }
    for (let i = 0; i < 4; i += 1) {
      this.gainPool.push(
        scene.add
          .bitmapText(0, 0, 'pixel', '', 16)
          .setScale(2)
          .setTint(0xffd23f)
          .setOrigin(0.5)
          .setDepth(36)
          .setVisible(false),
      );
    }
    for (let i = 0; i < 12; i += 1) {
      this.impactPool.push(this.makeSprite('merge', 31));
      this.slashPool.push(this.makeSprite('slash', 30));
    }
  }

  hit(
    x: number,
    y: number,
    damage: number,
    accent: number,
    target: Phaser.GameObjects.Image,
    strong: boolean,
  ): void {
    const label = this.damagePool.find((text) => !text.visible);
    if (label !== undefined) {
      label
        .setText(`HIT ${damage}`)
        .setPosition(x, y)
        .setAlpha(1)
        .setScale(2)
        .setVisible(true);
      this.scene.tweens.add({
        targets: label,
        y: y - 52,
        alpha: 0,
        duration: 470,
        onComplete: () => label.setVisible(false),
      });
    }

    this.playPooled(
      this.impactPool,
      'merge',
      this.impactCursor,
      x,
      y,
      accent,
      strong ? 0.48 : 0.32,
      strong ? 390 : 330,
    );
    this.impactCursor = (this.impactCursor + 1) % this.impactPool.length;
    this.playPooled(
      this.slashPool,
      'slash',
      this.slashCursor,
      x,
      y,
      accent,
      strong ? 0.72 : 0.5,
      280,
      Phaser.Math.Between(-22, 22),
    );
    this.slashCursor = (this.slashCursor + 1) % this.slashPool.length;

    // Wall-clock, not scene.time: a strong hit sets time.timeScale to 0.12 for
    // the hit-stop, which would otherwise leave the target solid white.
    target.setTintFill(0xffffff);
    window.setTimeout(() => {
      if (target.active) target.clearTint();
    }, 70);
  }

  defeat(x: number, y: number, boss: boolean): void {
    const count = boss ? 3 : 2;
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
      this.playPooled(
        this.impactPool,
        'merge',
        this.impactCursor,
        x + Math.cos(angle) * (boss ? 34 : 18),
        y + Math.sin(angle) * (boss ? 30 : 14),
        i === 0 ? 0xffffff : 0xffd98a,
        boss ? 0.7 : 0.42,
        boss ? 460 : 360,
        i * 24,
      );
      this.impactCursor = (this.impactCursor + 1) % this.impactPool.length;
    }
  }

  /** A one-off reward readout ("+240"), reserved for real payoffs, never trickle. */
  gain(x: number, y: number, message: string): void {
    const label = this.gainPool.find((text) => !text.visible);
    if (label === undefined) return;
    label
      .setText(message)
      .setPosition(x, y - 20)
      .setAlpha(1)
      .setScale(2)
      .setVisible(true);
    this.scene.tweens.add({
      targets: label,
      y: y - 72,
      alpha: 0,
      duration: 600,
      ease: 'Quad.easeOut',
      onComplete: () => label.setVisible(false),
    });
  }

  private makeSprite(
    id: VfxAnimationId,
    depth: number,
  ): Phaser.GameObjects.Sprite {
    return this.scene.add
      .sprite(-100, -100, VFX_ANIMATIONS[id].textureKey, 0)
      .setDepth(depth)
      .setVisible(false);
  }

  private playPooled(
    pool: Phaser.GameObjects.Sprite[],
    id: VfxAnimationId,
    cursor: number,
    x: number,
    y: number,
    tint: number,
    scale: number,
    duration: number,
    angle = 0,
  ): void {
    const sprite = pool[cursor]!;
    const def = VFX_ANIMATIONS[id];
    this.scene.tweens.killTweensOf(sprite);
    sprite
      .stop()
      .setTexture(def.textureKey, 0)
      .setPosition(x, y)
      .setTint(tint)
      .setScale(scale)
      .setAngle(angle)
      .setAlpha(1)
      .setVisible(true)
      .play(def.animationKey);
    this.scene.tweens.add({
      targets: sprite,
      scale: scale * 1.16,
      alpha: 0,
      duration,
      ease: 'Quad.easeOut',
      onComplete: () => sprite.stop().setVisible(false),
    });
  }
}
