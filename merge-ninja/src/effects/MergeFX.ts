import Phaser from 'phaser';
import { BALANCE } from '../data/balance';
import { ninjaDef } from '../data/ninjas';
import { VFX_ANIMATIONS, type VfxAnimationId } from '../data/vfxAssets';

/** Reusable animated merge effects; every object is pooled and replayed. */
export class MergeFX {
  private readonly smokePool: Phaser.GameObjects.Sprite[] = [];
  private readonly burstPool: Phaser.GameObjects.Sprite[] = [];
  private smokeCursor = 0;
  private burstCursor = 0;

  constructor(private readonly scene: Phaser.Scene) {
    for (let i = 0; i < 8; i += 1) {
      this.smokePool.push(this.makeSprite('smoke', 25));
      this.burstPool.push(this.makeSprite('merge', 26));
    }
  }

  play(x: number, y: number, tier: number): void {
    const accent = ninjaDef(tier).accent;
    this.playPooled(
      this.smokePool,
      'smoke',
      this.smokeCursor,
      x,
      y + 12,
      accent,
      0.48,
      470,
    );
    this.smokeCursor = (this.smokeCursor + 1) % this.smokePool.length;
    this.playPooled(
      this.burstPool,
      'merge',
      this.burstCursor,
      x,
      y,
      0xfff4a8,
      0.62,
      430,
    );
    this.burstCursor = (this.burstCursor + 1) % this.burstPool.length;
  }

  flash(x: number, y: number): void {
    this.playPooled(
      this.burstPool,
      'merge',
      this.burstCursor,
      x,
      y,
      0xffffff,
      0.48,
      330,
    );
    this.burstCursor = (this.burstCursor + 1) % this.burstPool.length;
  }

  get duration(): number {
    return BALANCE.fx.mergeDuration;
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
      .setAlpha(1)
      .setVisible(true)
      .play(def.animationKey);
    this.scene.tweens.add({
      targets: sprite,
      scale: scale * 1.14,
      alpha: 0,
      duration,
      ease: 'Quad.easeOut',
      onComplete: () => sprite.stop().setVisible(false),
    });
  }
}
