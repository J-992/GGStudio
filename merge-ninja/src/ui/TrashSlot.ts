import Phaser from 'phaser';
import { ATLAS_KEY } from '../render/atlasConfig';
import { VFX_ANIMATIONS } from '../data/vfxAssets';
import { theme } from './theme';

/**
 * Drag-release reach around the bin, in multiples of its visual radius. The
 * bin is small and sits at the screen edge, so the drop target is far more
 * forgiving than the drawing: little hands should never miss a sell.
 */
export const TRASH_PICKUP_RADIUS = 2.2;

const GLOW_TINT = 0xff5a4d;

export class TrashSlot extends Phaser.GameObjects.Container {
  private readonly trashBody: Phaser.GameObjects.Image;
  /** Red ring behind the bin that breathes while a drag hovers it. */
  private readonly glowRing: Phaser.GameObjects.Sprite;
  private glowTween: Phaser.Tweens.Tween | null = null;
  private wobbleTween: Phaser.Tweens.Tween | null = null;
  private hovered = false;

  constructor(scene: Phaser.Scene) {
    const r = theme.layout.trash;
    super(scene, r.x, r.y);
    scene.add.existing(this).setDepth(8);
    this.glowRing = scene.add.sprite(0, 0, VFX_ANIMATIONS.shockwave.textureKey, 0).setTint(GLOW_TINT).setAlpha(0).setScale(0.3);
    this.trashBody = scene.add.image(0, 0, ATLAS_KEY, 'icon_trash').setScale(2);
    this.add([this.glowRing, this.trashBody]);
    this.setSize(r.radius * 2, r.radius * 2).setInteractive();
  }

  /**
   * Hover feedback for an aimed sell. Driven by MergeBoard's drag proximity
   * (the same x2.2 radius test that resolves the release), never by pointer
   * hover alone, so it works identically on touch.
   */
  setTrashActive(active: boolean): void {
    if (this.hovered === active) return;
    this.hovered = active;
    this.trashBody.setTint(active ? GLOW_TINT : 0xffffff);
    if (active) {
      this.glowTween?.remove();
      this.wobbleTween?.remove();
      this.glowRing.play({ key: VFX_ANIMATIONS.shockwave.animationKey, repeat: -1 });
      this.glowTween = this.scene.tweens.add({
        targets: this.glowRing,
        alpha: { from: 0.55, to: 0.9 },
        scale: { from: 0.26, to: 0.36 },
        yoyo: true,
        repeat: -1,
        duration: 160,
        ease: 'Sine.easeInOut',
      });
      this.wobbleTween = this.scene.tweens.add({
        targets: this.trashBody,
        angle: { from: -7, to: 7 },
        yoyo: true,
        repeat: -1,
        duration: 90,
        ease: 'Sine.easeInOut',
      });
    } else {
      this.glowTween?.remove();
      this.wobbleTween?.remove();
      this.glowTween = null;
      this.wobbleTween = null;
      this.glowRing.stop().setFrame(0).setAlpha(0).setScale(0.3);
      this.trashBody.setAngle(0);
    }
  }

  relayout(): void {
    this.setPosition(theme.layout.trash.x, theme.layout.trash.y);
    this.setSize(theme.layout.trash.radius * 2, theme.layout.trash.radius * 2);
  }
}
