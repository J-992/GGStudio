import Phaser from 'phaser';
import { ATLAS_KEY } from '../render/atlasConfig';
import { VFX_ANIMATIONS } from '../data/vfxAssets';
import { POTION, potionGapMs } from '../data/pickups';
import { theme } from './theme';
import type { GameCore } from '../core/GameCore';
import type { Fx } from '../effects/Fx';
import type { Sfx } from '../audio/Sfx';

/** Tap radius around the bottle's centre, in layout pixels. */
const TAP_RADIUS = 62;

/**
 * The red health flask that drifts across the arena.
 *
 * It is the golden clock's sibling in every mechanical respect -- same lane,
 * same bob, same "the scene owns the tap stream" collection -- and differs only
 * in what it hands back and how often it turns up. A run can end now, so this
 * is the pressure valve: bottles come about twice as often as the clock, and
 * far more often once the line is in real trouble.
 */
export class HealthPotion extends Phaser.GameObjects.Container {
  private readonly bottle: Phaser.GameObjects.Image;
  private readonly halo: Phaser.GameObjects.Arc;
  private nextSpawnMs: number = POTION.firstSpawnMs;
  private travelMs = 0;
  private laneY = 0;
  private fromX = 0;
  private toX = 0;
  private bobPhase = 0;
  private live = false;

  constructor(
    private readonly sceneRef: Phaser.Scene,
    private readonly core: GameCore,
    private readonly fx: Fx,
    private readonly sfx: Sfx,
    private readonly blocked: () => boolean,
  ) {
    super(sceneRef, 0, 0);
    sceneRef.add.existing(this).setDepth(300);

    this.halo = sceneRef.add.circle(0, 0, 40, 0xff8a86, 0.24);
    this.bottle = sceneRef.add.image(0, 0, ATLAS_KEY, 'icon_potion').setScale(2.1);
    this.add([this.halo, this.bottle]);
    this.setVisible(false);
  }

  get isLive(): boolean {
    return this.live;
  }

  /** Real-time update: the pickup and its timers ignore the sim speed. */
  override update(dtMs: number): void {
    if (this.blocked()) return;

    if (!this.live) {
      // A line at full health has nothing to gain, so the timer waits rather
      // than burning a bottle nobody would bother tapping.
      if (this.core.playerHealth >= this.core.playerMaxHealth) return;
      this.nextSpawnMs -= dtMs;
      if (this.nextSpawnMs <= 0) this.spawn();
      return;
    }

    this.travelMs += dtMs;
    const progress = this.travelMs / POTION.travelMs;
    if (progress >= 1) {
      this.despawn();
      return;
    }

    this.bobPhase += dtMs;
    const x = Phaser.Math.Linear(this.fromX, this.toX, progress);
    const y = this.laneY + Math.sin((this.bobPhase / POTION.bobMs) * Math.PI * 2) * POTION.bobPixels;
    this.setPosition(x, y);
    this.bottle.setAngle(Math.sin((this.bobPhase / 820) * Math.PI) * 11);
    this.setAlpha(Phaser.Math.Clamp(Math.min(progress, 1 - progress) * 12, 0, 1));
  }

  relayout(): void {
    if (!this.live) return;
    const l = theme.layout;
    this.laneY = Phaser.Math.Clamp(this.laneY, l.arena.y + 90, l.arena.y + l.arena.h - 90);
  }

  /** Is this press on the pickup? Generous, because it is a moving target. */
  hits(pointer: Phaser.Input.Pointer): boolean {
    if (!this.live || !this.visible) return false;
    return Phaser.Math.Distance.Between(pointer.x, pointer.y, this.x, this.y) <= TAP_RADIUS;
  }

  /** Claims the press if it landed on the bottle. Returns true when consumed. */
  tryCollect(pointer: Phaser.Input.Pointer): boolean {
    if (!this.hits(pointer)) return false;
    this.collect();
    return true;
  }

  /** Debug/verification hook: force a bottle into the air right now. */
  forceSpawn(): void {
    if (this.live) return;
    this.spawn();
  }

  private spawn(): void {
    const l = theme.layout;
    const leftToRight = Math.random() < 0.5;
    this.fromX = leftToRight ? -70 : l.width + 70;
    this.toX = leftToRight ? l.width + 70 : -70;
    this.laneY = Phaser.Math.Between(l.arena.y + 110, l.arena.y + l.arena.h - 110);
    this.travelMs = 0;
    this.bobPhase = Math.random() * POTION.bobMs;
    this.live = true;
    this.setPosition(this.fromX, this.laneY).setAlpha(0).setVisible(true).setScale(1);

    this.sceneRef.tweens.killTweensOf(this.halo);
    this.halo.setScale(1).setAlpha(0.24);
    this.sceneRef.tweens.add({
      targets: this.halo,
      scale: 1.32,
      alpha: 0.44,
      duration: 640,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private collect(): void {
    if (!this.live) return;
    this.live = false;

    const healed = this.core.healPlayer(Math.ceil(this.core.playerMaxHealth * POTION.healRatio));
    this.sfx.play('merge');
    this.fx.mergeFlash(this.x, this.y);
    this.scatter();
    this.showHealText(healed);
    this.sceneRef.tweens.killTweensOf(this.halo);

    this.sceneRef.tweens.add({
      targets: this,
      scale: 1.5,
      alpha: 0,
      duration: 260,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        this.setVisible(false).setScale(1).setAlpha(1);
        this.scheduleNext();
      },
    });
  }

  private despawn(): void {
    this.live = false;
    this.setVisible(false).setAlpha(1);
    this.sceneRef.tweens.killTweensOf(this.halo);
    this.scheduleNext();
  }

  private scheduleNext(): void {
    this.nextSpawnMs = potionGapMs(this.core.healthRatio, Math.random());
  }

  private showHealText(healed: number): void {
    const label = this.sceneRef.add
      .bitmapText(this.x, this.y - 20, 'pixel', `+${healed} HP`, 14)
      .setOrigin(0.5)
      .setTint(0x8cf07a)
      .setDepth(303);
    this.sceneRef.tweens.add({
      targets: label,
      y: label.y - 74,
      alpha: 0,
      scale: 1.5,
      duration: 900,
      ease: 'Cubic.easeOut',
      onComplete: () => label.destroy(),
    });
  }

  private scatter(): void {
    const merge = VFX_ANIMATIONS.merge;
    for (let i = 0; i < 8; i += 1) {
      const spark = this.sceneRef.add.sprite(this.x, this.y, merge.textureKey, 0).setDepth(302).setScale(0.14).setTint(0xff9a94).play(merge.animationKey);
      const angle = (Math.PI * 2 * i) / 8;
      this.sceneRef.tweens.add({
        targets: spark,
        x: this.x + Math.cos(angle) * 104,
        y: this.y + Math.sin(angle) * 104,
        alpha: 0,
        scale: 0.03,
        duration: 480,
        ease: 'Cubic.easeOut',
        onComplete: () => spark.destroy(),
      });
    }
  }
}
