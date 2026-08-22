import Phaser from 'phaser';
import { ATLAS_KEY, FX_FRAMES } from '../render/atlasConfig';
import {
  VFX_ANIMATIONS,
  type VfxAnimationId,
} from '../data/vfxAssets';
import { theme } from '../ui/theme';

/** Bounded reusable arena-only effects. The mask is the hard board-readability boundary. */
export class VFXManager {
  private readonly root: Phaser.GameObjects.Container;
  private readonly maskShape: Phaser.GameObjects.Graphics;
  private readonly pool: Phaser.GameObjects.Sprite[] = [];
  private cursor = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.root = scene.add.container(0, 0).setDepth(18);
    this.maskShape = scene.add
      .graphics()
      .fillRect(
        theme.layout.arena.x,
        theme.layout.arena.y,
        theme.layout.arena.w,
        theme.layout.arena.h,
      )
      .setVisible(false);
    this.root.setMask(this.maskShape.createGeometryMask());
    for (let i = 0; i < 64; i += 1) {
      const sprite = scene.add
        .sprite(-100, -100, VFX_ANIMATIONS.merge.textureKey, 0)
        .setVisible(false);
      this.pool.push(sprite);
      this.root.add(sprite);
    }
  }

  slash(
    x: number,
    y: number,
    color: number,
    size: number,
    angle: number,
    intensity = 1,
  ): void {
    const scale = Math.max(0.34, size * 0.34);
    const fx = this.takeVfx('slash', x, y, color, scale);
    fx.setAngle(angle).setAlpha(0.96);
    this.tween(
      fx,
      {
        scale: scale + Math.min(0.55, intensity * 0.16),
        alpha: 0,
        angle: angle + 10,
      },
      270,
    );
  }

  impact(x: number, y: number, color = 0xffffff): void {
    const fx = this.takeVfx('merge', x, y, color, 0.32);
    this.tween(fx, { scale: 0.48, alpha: 0 }, 340);
  }

  sparks(x: number, y: number, color: number, count = 5): void {
    this.burst('merge', x, y, color, count, 0.14);
  }

  smoke(x: number, y: number, color = 0x66707a): void {
    const fx = this.takeVfx('smoke', x, y, color, 0.34);
    fx.setOrigin(0.5, 0.72).setAlpha(0.82);
    this.tween(fx, { y: y - 20, scale: 0.5, alpha: 0 }, 470);
  }

  dust(x: number, y: number): void {
    const fx = this.takeVfx('smoke', x, y, 0xc7a87b, 0.28);
    fx.setOrigin(0.5, 0.72).setScale(0.42, 0.24).setAlpha(0.7);
    this.tween(fx, { scaleX: 0.68, scaleY: 0.34, alpha: 0 }, 430);
  }

  shockwave(x: number, y: number, color: number, size = 2): void {
    const finalScale = Math.min(1.1, Math.max(0.34, size * 0.25));
    const fx = this.takeVfx('shockwave', x, y, color, 0.12);
    fx.setAlpha(0.86);
    this.tween(fx, { scale: finalScale, alpha: 0 }, 350);
  }

  energyRing(x: number, y: number, color: number): void {
    this.shockwave(x, y, color, 2);
  }

  lightning(x: number, y: number, color: number): void {
    const fx = this.takeVfx('lightning', x, y, color, 0.55);
    fx.setOrigin(0.5, 0.72).setAlpha(0.96);
    this.tween(fx, { scale: 0.72, alpha: 0 }, 310);
  }

  afterimage(sprite: Phaser.GameObjects.Sprite): void {
    // Character portraits are loaded as their own supplied textures rather
    // than atlas frames. A pooled atlas sprite cannot render those unless it
    // borrows the live texture and frame for this one trail.
    const fx = this.takeTexture(
      sprite.texture.key,
      sprite.frame.name,
      sprite.x - 12,
      sprite.y,
      sprite.tintTopLeft,
      sprite.scaleX,
    );
    fx.setFlipX(sprite.flipX)
      .setScale(sprite.scaleX, sprite.scaleY)
      .setAngle(sprite.angle)
      .setAlpha(0.35);
    this.tween(fx, { x: sprite.x - 42, alpha: 0 }, 180);
  }

  teleportFlash(x: number, y: number, color = 0xe9f7ff): void {
    this.shockwave(x, y, color, 1.8);
    const spark = this.takeVfx('merge', x, y, color, 0.26);
    this.tween(spark, { scale: 0.5, alpha: 0 }, 330);
  }

  portal(x: number, y: number, color = 0xffffff): void {
    const fx = this.takeVfx('portal', x, y, color, 0.48);
    fx.setAlpha(0.92);
    this.tween(fx, { scale: 0.68, alpha: 0, angle: 22 }, 520);
  }

  projectile(
    kind: 'shuriken' | 'coin',
    from: Phaser.Math.Vector2,
    to: Phaser.Math.Vector2,
    color = 0xffffff,
  ): void {
    const fx =
      kind === 'coin'
        ? this.takeTexture(
            ATLAS_KEY,
            FX_FRAMES.coin,
            from.x,
            from.y,
            color,
            1,
          )
        : this.takeTexture(
            'powerup_shuriken_frenzy',
            0,
            from.x,
            from.y,
            color,
            0.52,
          );
    this.tween(
      fx,
      { x: to.x, y: to.y, angle: 540, alpha: 0, scale: fx.scaleX * 0.72 },
      300,
    );
  }

  /** Vertical flame column a boss rises through. */
  pillarOfLight(x: number, y: number, color: number, height = 3): void {
    const fx = this.takeVfx('flame', x, y, color, 0.44);
    fx.setOrigin(0.5, 0.82)
      .setScale(0.42, Math.max(0.65, height * 0.32))
      .setAlpha(0.88);
    this.tween(
      fx,
      { scaleX: 0.56, scaleY: Math.max(0.8, height * 0.38), alpha: 0 },
      440,
    );
  }

  /** Reality splits sideways, then seals shut behind the boss. */
  riftTear(x: number, y: number, color: number, width = 3): void {
    const fx = this.takeVfx('portal', x, y, color, 0.4);
    fx.setScale(0.12, 0.52).setAlpha(0.94).setAngle(4);
    this.tween(
      fx,
      {
        scaleX: Math.min(1.2, Math.max(0.55, width * 0.24)),
        scaleY: 0.58,
        angle: -4,
        alpha: 0,
      },
      520,
    );
  }

  /** A seal draws itself around the summoning spot before the boss fades in. */
  summonCircle(x: number, y: number, color: number, size = 2): void {
    const fx = this.takeVfx('shockwave', x, y, color, 0.12);
    fx.setAlpha(0.18).setAngle(20);
    this.tween(
      fx,
      { scale: Math.min(1.05, Math.max(0.45, size * 0.28)), angle: 80, alpha: 0.82 },
      440,
    );
    this.sparks(x, y, color, 3);
  }

  /** Flame streaks chasing a boss that is dropping in from above. */
  skyFallTrail(x: number, y: number, color: number): void {
    for (let i = 0; i < 3; i += 1) {
      const fx = this.takeVfx(
        'flame',
        x,
        y - 96 - i * 56,
        color,
        0.32 + i * 0.08,
      );
      fx.setOrigin(0.5, 0.8).setAlpha(0.82 - i * 0.18);
      this.tween(fx, { y: y + 12, alpha: 0 }, 300 + i * 45);
    }
  }

  /** Floor flames burst upward as something climbs out of it. */
  eruptionBurst(x: number, y: number, color: number, count = 4): void {
    const n = Math.min(5, Math.max(2, count));
    for (let i = 0; i < n; i += 1) {
      const spread = (i / (n - 1) - 0.5) * 64;
      const scale = 0.28 + i * 0.035;
      const fx = this.takeVfx('flame', x + spread, y, color, scale);
      fx.setOrigin(0.5, 0.82).setAngle(spread * 0.08);
      this.tween(
        fx,
        {
          y: y - (28 + i * 10),
          scale: scale * 1.25,
          angle: spread * 0.14,
          alpha: 0,
        },
        380 + i * 25,
      );
    }
  }

  relayout(): void {
    const a = theme.layout.arena;
    this.maskShape.clear().fillRect(a.x, a.y, a.w, a.h);
  }

  private burst(
    id: VfxAnimationId,
    x: number,
    y: number,
    color: number,
    count: number,
    scale: number,
  ): void {
    for (let i = 0; i < count; i += 1) {
      const fx = this.takeVfx(id, x, y, color, scale);
      const angle = (i * Math.PI * 2) / count;
      const reach = 22 + i * 5;
      this.tween(
        fx,
        {
          x: x + Math.cos(angle) * reach,
          y: y + Math.sin(angle) * reach,
          alpha: 0,
          scale: scale * 0.72,
        },
        330,
      );
    }
  }

  private takeVfx(
    id: VfxAnimationId,
    x: number,
    y: number,
    color: number,
    scale: number,
  ): Phaser.GameObjects.Sprite {
    const def = VFX_ANIMATIONS[id];
    const fx = this.takeTexture(def.textureKey, 0, x, y, color, scale);
    fx.play(def.animationKey);
    return fx;
  }

  private takeTexture(
    texture: string,
    frame: string | number,
    x: number,
    y: number,
    color: number,
    scale: number,
  ): Phaser.GameObjects.Sprite {
    const fx = this.pool[this.cursor]!;
    this.cursor = (this.cursor + 1) % this.pool.length;
    this.scene.tweens.killTweensOf(fx);
    fx.stop();
    return fx
      .setTexture(texture, frame)
      .setOrigin(0.5)
      .setPosition(x, y)
      .setTint(color)
      .setScale(scale)
      .setFlip(false, false)
      .setAngle(0)
      .setAlpha(1)
      .setVisible(true);
  }

  private tween(
    fx: Phaser.GameObjects.Sprite,
    properties: object,
    duration: number,
  ): void {
    this.scene.tweens.add({
      targets: fx,
      ...properties,
      duration,
      onComplete: () => fx.stop().setVisible(false),
    });
  }
}
