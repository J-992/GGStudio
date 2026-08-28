import Phaser from 'phaser';
import { ATLAS_KEY } from '../render/atlasConfig';
import { VFX_ANIMATIONS } from '../data/vfxAssets';
import { theme } from './theme';
import type { GameCore } from '../core/GameCore';
import type { Fx } from '../effects/Fx';
import type { Sfx } from '../audio/Sfx';

/**
 * Tuning for the golden clock pickup.
 *
 * It is deliberately rare: the point is a small jolt of "drop everything and
 * tap that" every couple of minutes, not a reflex tax. Spawn timers only run
 * while the player can actually see the board, so a long modal never burns a
 * spawn the player had no chance at.
 */
export const CLOCK = {
  multiplier: 10,
  boostMs: 10_000,
  firstSpawnMs: 45_000,
  minGapMs: 80_000,
  maxGapMs: 165_000,
  travelMs: 11_000,
  bobPixels: 46,
  bobMs: 2_300,
} as const;

/** Tap radius around the clock's centre, in layout pixels. */
const TAP_RADIUS = 62;

/** The floating clock plus the "SPEED x10" banner it turns into. */
export class TimeClock extends Phaser.GameObjects.Container {
  private readonly clock: Phaser.GameObjects.Image;
  private readonly halo: Phaser.GameObjects.Arc;
  private readonly banner: Phaser.GameObjects.Container;
  private readonly bannerLabel: Phaser.GameObjects.BitmapText;
  private readonly bannerBar: Phaser.GameObjects.Rectangle;
  private readonly bannerBarWidth = 236;
  private nextSpawnMs: number = CLOCK.firstSpawnMs;
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

    this.halo = sceneRef.add.circle(0, 0, 42, 0xffe07a, 0.26);
    this.clock = sceneRef.add.image(0, 0, ATLAS_KEY, 'icon_clock').setScale(2.2);
    // Collection is driven from the scene's pointer handler via tryCollect()
    // rather than the object's own input: the board and the pickup share one
    // tap stream, and only one of them may claim any given press.
    this.add([this.halo, this.clock]);
    this.setVisible(false);

    const bannerBg = sceneRef.add.rectangle(0, 0, 260, 62, 0x2a1c0c).setStrokeStyle(4, 0xffc63f);
    this.bannerLabel = sceneRef.add
      .bitmapText(0, -12, 'pixel', `SPEED X${CLOCK.multiplier}`, 14)
      .setOrigin(0.5)
      .setTint(0xffd76a);
    this.bannerBar = sceneRef.add.rectangle(-this.bannerBarWidth / 2, 16, this.bannerBarWidth, 10, 0xffc63f).setOrigin(0, 0.5);
    this.banner = sceneRef.add.container(0, 0, [bannerBg, this.bannerLabel, this.bannerBar]).setVisible(false);
    this.banner.setDepth(301);
    sceneRef.add.existing(this.banner);

    this.relayout();
  }

  get isLive(): boolean {
    return this.live;
  }

  /** Real-time update: the pickup and its timers ignore the sim speed. */
  override update(dtMs: number): void {
    this.syncBanner();
    if (this.blocked()) return;

    if (!this.live) {
      this.nextSpawnMs -= dtMs;
      if (this.nextSpawnMs <= 0) this.spawn();
      return;
    }

    this.travelMs += dtMs;
    const progress = this.travelMs / CLOCK.travelMs;
    if (progress >= 1) {
      this.despawn();
      return;
    }

    this.bobPhase += dtMs;
    const x = Phaser.Math.Linear(this.fromX, this.toX, progress);
    const y = this.laneY + Math.sin((this.bobPhase / CLOCK.bobMs) * Math.PI * 2) * CLOCK.bobPixels;
    this.setPosition(x, y);
    this.clock.setAngle(Math.sin((this.bobPhase / 900) * Math.PI) * 9);
    // Fade in and out at the edges so it drifts on rather than popping in.
    this.setAlpha(Phaser.Math.Clamp(Math.min(progress, 1 - progress) * 12, 0, 1));
  }

  relayout(): void {
    const l = theme.layout;
    // Centred over the arena panel and clear of the boss name plate.
    this.banner.setPosition(l.arena.x + l.arena.w / 2, l.arena.y + (l.landscape ? 168 : 176));
    if (!this.live) return;
    this.laneY = Phaser.Math.Clamp(this.laneY, l.arena.y + 90, l.arena.y + l.arena.h - 90);
  }

  /** Is this press on the pickup? Generous, because it is a moving target. */
  hits(pointer: Phaser.Input.Pointer): boolean {
    if (!this.live || !this.visible) return false;
    return Phaser.Math.Distance.Between(pointer.x, pointer.y, this.x, this.y) <= TAP_RADIUS;
  }

  /** Claims the press if it landed on the clock. Returns true when consumed. */
  tryCollect(pointer: Phaser.Input.Pointer): boolean {
    if (!this.hits(pointer)) return false;
    this.collect();
    return true;
  }

  /** Debug/verification hook: force a clock into the air right now. */
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
    this.bobPhase = Math.random() * CLOCK.bobMs;
    this.live = true;
    this.setPosition(this.fromX, this.laneY).setAlpha(0).setVisible(true).setScale(1);

    this.sceneRef.tweens.killTweensOf(this.halo);
    this.halo.setScale(1).setAlpha(0.26);
    this.sceneRef.tweens.add({
      targets: this.halo,
      scale: 1.35,
      alpha: 0.45,
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private collect(): void {
    if (!this.live) return;
    this.live = false;

    this.core.startTimeBoost(CLOCK.multiplier, CLOCK.boostMs);
    this.sfx.play('timer');
    this.fx.mergeFlash(this.x, this.y);
    this.scatter();
    this.sceneRef.tweens.killTweensOf(this.halo);

    // Fly the pickup up into the banner it becomes.
    this.sceneRef.tweens.add({
      targets: this,
      x: this.banner.x,
      y: this.banner.y,
      scale: 0.4,
      alpha: 0,
      duration: 320,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        this.setVisible(false).setScale(1).setAlpha(1);
        this.scheduleNext();
      },
    });
    this.showBanner();
  }

  private despawn(): void {
    this.live = false;
    this.setVisible(false).setAlpha(1);
    this.sceneRef.tweens.killTweensOf(this.halo);
    this.scheduleNext();
  }

  private scheduleNext(): void {
    this.nextSpawnMs = Phaser.Math.Between(CLOCK.minGapMs, CLOCK.maxGapMs);
  }

  private showBanner(): void {
    this.banner.setVisible(true).setAlpha(0).setScale(0.7);
    this.sceneRef.tweens.add({ targets: this.banner, alpha: 1, scale: 1, duration: 240, ease: 'Back.easeOut' });
    this.sceneRef.tweens.add({
      targets: this.bannerLabel,
      scale: 1.12,
      duration: 420,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private syncBanner(): void {
    const boost = this.core.timeBoost;
    if (!boost.active) {
      if (!this.banner.visible) return;
      this.sceneRef.tweens.killTweensOf(this.bannerLabel);
      this.bannerLabel.setScale(1);
      this.sceneRef.tweens.add({
        targets: this.banner,
        alpha: 0,
        duration: 220,
        onComplete: () => this.banner.setVisible(false),
      });
      return;
    }
    this.bannerBar.setSize(this.bannerBarWidth * (boost.remainingMs / CLOCK.boostMs), 10);
  }

  private scatter(): void {
    const merge = VFX_ANIMATIONS.merge;
    for (let i = 0; i < 10; i += 1) {
      const spark = this.sceneRef.add.sprite(this.x, this.y, merge.textureKey, 0).setDepth(302).setScale(0.14).setTint(0xffe58a).play(merge.animationKey);
      const angle = (Math.PI * 2 * i) / 10;
      this.sceneRef.tweens.add({
        targets: spark,
        x: this.x + Math.cos(angle) * 120,
        y: this.y + Math.sin(angle) * 120,
        alpha: 0,
        scale: 0.03,
        angle: 180,
        duration: 520,
        ease: 'Cubic.easeOut',
        onComplete: () => spark.destroy(),
      });
    }
  }
}
