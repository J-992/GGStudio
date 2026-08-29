import Phaser from 'phaser';
import { ATLAS_KEY } from '../render/atlasConfig';
import { VFX_ANIMATIONS } from '../data/vfxAssets';
import { theme } from './theme';
import type { DojoStyleDef } from '../data/dojoStyles';

/** How long the announcement holds at full strength before it clears. */
const HOLD_MS = 1150;

/**
 * "STAGE 12 REACHED", announced each time the next boss steps through the gate.
 *
 * The stage number is the only number in the game that always goes up, so it is
 * the run's real scoreboard -- but until now it only existed as small text on
 * the boss plate and nothing marked the moment it changed. This is that moment.
 *
 * Nothing here is interactive and the whole thing lives above the arena but
 * below every modal, so it can never swallow a tap or cover a game over.
 */
export class StageBanner extends Phaser.GameObjects.Container {
  private readonly plate: Phaser.GameObjects.NineSlice;
  private readonly stageText: Phaser.GameObjects.BitmapText;
  private readonly reachedText: Phaser.GameObjects.BitmapText;
  private readonly flash: Phaser.GameObjects.Rectangle;
  private readonly rays: Phaser.GameObjects.Sprite[] = [];
  private timer: Phaser.Time.TimerEvent | null = null;

  constructor(private readonly sceneRef: Phaser.Scene) {
    super(sceneRef, 0, 0);
    sceneRef.add.existing(this).setDepth(310).setVisible(false);

    this.flash = sceneRef.add.rectangle(0, 0, 520, 96, 0xffe07a, 0.14);
    this.plate = sceneRef.add.nineslice(0, 0, ATLAS_KEY, 'banner_name_9', 420, 84, 11, 11, 7, 7).setTint(0xd9a441);
    // The bitmap font has no lowercase glyphs, so both lines are shouted.
    this.stageText = sceneRef.add.bitmapText(0, -14, 'pixel', 'STAGE 1', 14).setOrigin(0.5).setScale(2).setTint(0xfff6dd);
    this.reachedText = sceneRef.add.bitmapText(0, 22, 'pixel', 'REACHED', 14).setOrigin(0.5).setTint(0x3a2a12);
    for (let i = 0; i < 8; i += 1) {
      this.rays.push(sceneRef.add.sprite(0, 0, VFX_ANIMATIONS.merge.textureKey, 0).setScale(0.14).setTint(0xffe07a).setVisible(false));
    }
    this.add([this.flash, ...this.rays, this.plate, this.stageText, this.reachedText]);
    this.relayout();
  }

  /** Announce a stage. Re-announcing replaces whatever is on screen. */
  show(stage: number): void {
    this.announce(`STAGE ${stage}`, 'REACHED');
  }

  /**
   * Announce any two-line message through the single-banner container. The
   * bitmap font has no lowercase glyphs, so callers shout. Pass a warm light
   * `subTint` when the second line carries the payload (an amount, a bonus) —
   * the default dark tint only works for short captions like REACHED.
   */
  announce(mainText: string, subText: string, subTint = 0x3a2a12): void {
    this.timer?.remove();
    this.sceneRef.tweens.killTweensOf([this, this.plate, this.stageText, this.flash]);

    this.stageText.setText(mainText);
    this.reachedText.setText(subText);
    this.reachedText.setTint(subTint);
    this.reachedText.setVisible(subText.length > 0);
    this.relayout();
    this.setVisible(true).setAlpha(0).setScale(0.82);
    this.plate.setAngle(0);

    this.sceneRef.tweens.add({ targets: this, alpha: 1, scale: 1, duration: 260, ease: 'Back.easeOut' });
    // A single heartbeat on the number rather than a loop: it has to feel like
    // an arrival and then get out of the way of the fight behind it.
    this.sceneRef.tweens.add({
      targets: this.stageText,
      scale: { from: 2.5, to: 2 },
      duration: 320,
      ease: 'Back.easeOut',
    });
    this.sceneRef.tweens.add({ targets: this.flash, alpha: { from: 0.42, to: 0.1 }, duration: 420, ease: 'Quad.easeOut' });
    this.burst();

    this.timer = this.sceneRef.time.delayedCall(HOLD_MS, () => this.dismiss());
  }

  relayout(): void {
    const a = theme.layout.arena;
    const width = Math.min(a.w - 60, theme.layout.landscape ? 420 : 460);
    this.setPosition(a.x + a.w / 2, a.y + Math.round(a.h * 0.3));
    this.plate.setSize(width, 84);
    this.flash.setSize(width + 90, 96);
  }

  applyDojoStyle(style: DojoStyleDef): void {
    const crimson = style.id === 'crimson-dojo';
    this.plate.setTint(crimson ? style.palette.plate : 0xd9a441);
    this.flash.setFillStyle(crimson ? style.palette.accentBright : 0xffe07a, crimson ? .18 : .14);
    this.stageText.setTint(crimson ? 0xfff1c2 : 0xfff6dd);
    this.rays.forEach((ray) => ray.setTint(crimson ? style.palette.accentBright : 0xffe07a));
  }

  /** Verification hook: the headline currently on the plate, if any. */
  mainText(): string | null {
    return this.visible ? this.stageText.text : null;
  }

  private dismiss(): void {
    this.timer = null;
    this.sceneRef.tweens.add({
      targets: this,
      alpha: 0,
      scale: 1.08,
      duration: 300,
      ease: 'Quad.easeIn',
      onComplete: () => this.setVisible(false).setScale(1),
    });
  }

  /** Eight sparks thrown outward from the plate, then cleaned up by the tween. */
  private burst(): void {
    this.rays.forEach((ray, index) => {
      const angle = (Math.PI * 2 * index) / this.rays.length + Math.PI / 8;
      this.sceneRef.tweens.killTweensOf(ray);
      ray.setPosition(0, 0).setScale(0.14).setAlpha(0.95).setVisible(true).play(VFX_ANIMATIONS.merge.animationKey);
      this.sceneRef.tweens.add({
        targets: ray,
        x: Math.cos(angle) * 190,
        y: Math.sin(angle) * 82,
        scale: 0.03,
        alpha: 0,
        duration: 620,
        ease: 'Cubic.easeOut',
        onComplete: () => ray.setVisible(false),
      });
    });
  }
}
