import Phaser from 'phaser';
import type { GameCore } from '../core/GameCore';
import { theme } from '../ui/theme';
import type { PowerupId } from '../data/powerups';
import { VFX_ANIMATIONS } from '../data/vfxAssets';

/**
 * Persistent arena auras for running powerups.
 *
 * One-shot collection bursts already exist in the pickup layer; this class
 * answers the other half of "did that pickup do anything?" -- while an effect
 * runs, the arena itself shows it: spinning shurikens orbit the champion
 * during a frenzy, smoke rolls across the boss while its attacks are frozen,
 * gold sparkles climb during a charm, and a green dome shelters the champion
 * while ward charges remain.
 *
 * Anchors are read straight from `theme.layout` every frame, so resizes need
 * no bookkeeping here beyond re-cutting the arena mask.
 */
export class PowerupAuras {
  private static readonly FADE_MS = 220;
  private readonly root: Phaser.GameObjects.Container;
  private readonly maskShape: Phaser.GameObjects.Graphics;
  private readonly auras = new Map<PowerupId, Aura>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly core: GameCore,
  ) {
    const a = theme.layout.arena;
    this.root = scene.add.container(0, 0).setDepth(21);
    this.maskShape = scene.add.graphics().fillRect(a.x, a.y, a.w, a.h).setVisible(false);
    this.root.setMask(this.maskShape.createGeometryMask());
    this.auras.set('shurikenFrenzy', this.buildFrenzy());
    this.auras.set('luckyCharm', this.buildCharm());
    this.auras.set('protectiveWard', this.buildWard());
    this.auras.set('smokeBomb', this.buildSmoke());
    for (const aura of this.auras.values()) {
      // Adopting each group into the masked root both layers it at depth 21
      // and clips it to the arena, exactly like the pooled VFX manager.
      this.root.add(aura.group);
      aura.group.setVisible(false).setAlpha(0);
    }
  }

  update(dtMs: number): void {
    const active = new Set<PowerupId>(this.core.powerups.activeEffects().map((e) => e.id));
    if (this.core.powerups.wardCharges > 0) active.add('protectiveWard');
    const step = Math.max(0, dtMs);
    for (const [id, aura] of this.auras) {
      const wanted = active.has(id);
      aura.alpha = Phaser.Math.Linear(aura.alpha, wanted ? 1 : 0, Math.min(1, step / PowerupAuras.FADE_MS));
      if (!wanted && aura.alpha < 0.02) {
        aura.group.setVisible(false);
        continue;
      }
      aura.group.setVisible(true).setAlpha(aura.alpha);
      aura.draw(step);
    }
  }

  relayout(): void {
    const a = theme.layout.arena;
    this.maskShape.clear().fillRect(a.x, a.y, a.w, a.h);
  }

  /** Champion and enemy anchors, resolved fresh so resizes never desync. */
  private champion(): Phaser.Math.Vector2 {
    return new Phaser.Math.Vector2(theme.layout.champion.x, theme.layout.champion.y);
  }

  private enemy(): Phaser.Math.Vector2 {
    return new Phaser.Math.Vector2(theme.layout.enemy.x, theme.layout.enemy.y);
  }

  private buildFrenzy(): Aura {
    const champ = this.champion();
    const shockwave = VFX_ANIMATIONS.shockwave;
    const glow = this.scene.add.sprite(champ.x, champ.y + 26, shockwave.textureKey, 0)
      .setTint(0xff6b57)
      .setScale(0.62)
      .setAlpha(0.45);
    const stars = [0, 1].map(() =>
      this.scene.add.image(champ.x, champ.y, 'powerup_shuriken_frenzy').setTint(0xff8a5c).setScale(0.6),
    );
    const group = this.scene.add.container(0, 0, [glow, ...stars]);
    let phase = 0;
    return {
      group,
      alpha: 0,
      draw: (dt: number) => {
        const c = this.champion();
        phase += dt * 0.0042;
        if (!glow.anims.isPlaying) glow.play(shockwave.animationKey);
        glow.setPosition(c.x, c.y + 26).setAlpha(0.3 + Math.sin(phase * 2.4) * 0.12);
        stars.forEach((star, i) => {
          const angle = phase + i * Math.PI;
          star.setPosition(c.x + Math.cos(angle) * 78, c.y - 14 + Math.sin(angle) * 34)
            .setAngle(star.angle + dt * 0.42)
            .setScale(1.05 + Math.sin(angle * 2) * 0.12);
        });
      },
    };
  }

  private buildCharm(): Aura {
    const champ = this.champion();
    const shockwave = VFX_ANIMATIONS.shockwave;
    const merge = VFX_ANIMATIONS.merge;
    const ring = this.scene.add.sprite(champ.x, champ.y, shockwave.textureKey, 0).setTint(0xffc63f).setScale(0.62).setAlpha(0.55);
    const group = this.scene.add.container(0, 0, [ring]);
    const sparks: Phaser.GameObjects.Sprite[] = [];
    for (let i = 0; i < 7; i += 1) {
      const spark = this.scene.add.sprite(-100, -100, merge.textureKey, 0).setTint(0xffd23f).setVisible(false);
      sparks.push(spark);
      group.add(spark);
    }
    let nextSpark = 0;
    let sparkCursor = 0;
    return {
      group,
      alpha: 0,
      draw: (dt: number) => {
        const c = this.champion();
        if (!ring.anims.isPlaying) ring.play(shockwave.animationKey);
        ring.setPosition(c.x, c.y).setScale(0.58 + Math.sin(this.scene.time.now / 260) * 0.06);
        nextSpark -= dt;
        if (nextSpark <= 0) {
          nextSpark = 230;
          const spark = sparks[sparkCursor]!;
          sparkCursor = (sparkCursor + 1) % sparks.length;
          this.scene.tweens.killTweensOf(spark);
          spark.setPosition(c.x + Phaser.Math.Between(-64, 64), c.y + Phaser.Math.Between(-10, 40))
            .setScale(Phaser.Math.FloatBetween(0.12, 0.2))
            .setAlpha(0.95)
            .setVisible(true)
            .play(merge.animationKey);
          this.scene.tweens.add({ targets: spark, y: spark.y - Phaser.Math.Between(48, 84), alpha: 0, duration: 620, ease: 'Quad.easeOut', onComplete: () => spark.setVisible(false) });
        }
      },
    };
  }

  private buildWard(): Aura {
    const champ = this.champion();
    const shockwave = VFX_ANIMATIONS.shockwave;
    const dome = this.scene.add.sprite(champ.x, champ.y + 8, shockwave.textureKey, 0)
      .setTint(0x7dff9e)
      .setScale(0.72, 0.56)
      .setAlpha(0.48);
    const group = this.scene.add.container(0, 0, [dome]);
    return {
      group,
      alpha: 0,
      draw: () => {
        const c = this.champion();
        const breath = Math.sin(this.scene.time.now / 340) * 0.5 + 0.5;
        if (!dome.anims.isPlaying) dome.play(shockwave.animationKey);
        dome.setPosition(c.x, c.y + 8).setScale(0.7 + breath * 0.04, 0.54 + breath * 0.03).setAlpha(0.36 + breath * 0.14);
      },
    };
  }

  private buildSmoke(): Aura {
    const smoke = VFX_ANIMATIONS.smoke;
    const group = this.scene.add.container(0, 0, []);
    const puffs: Phaser.GameObjects.Sprite[] = [];
    for (let i = 0; i < 8; i += 1) {
      const puff = this.scene.add.sprite(-100, -100, smoke.textureKey, 0).setTint(0x8fd8ff).setVisible(false).setScale(0.32);
      puffs.push(puff);
      group.add(puff);
    }
    let nextPuff = 0;
    let puffCursor = 0;
    return {
      group,
      alpha: 0,
      draw: (dt: number) => {
        const e = this.enemy();
        nextPuff -= dt;
        if (nextPuff <= 0) {
          nextPuff = 210;
          const puff = puffs[puffCursor]!;
          puffCursor = (puffCursor + 1) % puffs.length;
          this.scene.tweens.killTweensOf(puff);
          puff.setPosition(e.x + Phaser.Math.Between(-90, 90), e.y + Phaser.Math.Between(-30, 46))
            .setScale(Phaser.Math.FloatBetween(0.24, 0.42))
            .setAlpha(Phaser.Math.FloatBetween(0.28, 0.52))
            .setVisible(true)
            .play(smoke.animationKey);
          this.scene.tweens.add({
            targets: puff,
            x: puff.x + Phaser.Math.Between(-36, 36),
            y: puff.y - Phaser.Math.Between(24, 60),
            alpha: 0,
            scale: puff.scaleX * 1.5,
            duration: Phaser.Math.Between(700, 1_100),
            ease: 'Sine.easeOut',
            onComplete: () => puff.setVisible(false),
          });
        }
      },
    };
  }
}

/** A living aura: a container of objects plus a per-frame redraw closure. */
interface Aura {
  readonly group: Phaser.GameObjects.Container;
  /** Current fade level, eased toward 1 while active and 0 otherwise. */
  alpha: number;
  draw(dtMs: number): void;
}
