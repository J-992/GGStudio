import Phaser from 'phaser';
import { theme } from './theme';

/**
 * A health bar whose fill is tweened via scaleX rather than redrawn.
 *
 * The value label sits *inside* the bar: drawing it above collided with the
 * enemy name in the arena's tight vertical rhythm, and centring it also keeps
 * the bar a single self-contained band that callers can position freely.
 */
export class HealthBar extends Phaser.GameObjects.Container {
  private static readonly HEIGHT = 26;

  private readonly fill: Phaser.GameObjects.Rectangle;
  private readonly label: Phaser.GameObjects.BitmapText;
  private ratio = -1;
  private labelValue = '';

  constructor(scene: Phaser.Scene, x: number, y: number, barWidth: number, color: number) {
    super(scene, x, y);
    scene.add.existing(this);

    this.add(
      new Phaser.GameObjects.Rectangle(scene, 0, 0, barWidth, HealthBar.HEIGHT, theme.colors.shadow)
        .setOrigin(0.5)
        .setStrokeStyle(2, theme.colors.panel),
    );

    this.fill = new Phaser.GameObjects.Rectangle(
      scene,
      -barWidth / 2 + 3,
      0,
      barWidth - 6,
      HealthBar.HEIGHT - 8,
      color,
    ).setOrigin(0, 0.5);
    this.add(this.fill);

    this.label = new Phaser.GameObjects.BitmapText(scene, 0, 0, 'pixel', '', 14)
      .setOrigin(0.5)
      .setTint(0xffffff);
    this.add(this.label);
  }

  setValue(value: number, max: number): void {
    const ratio = max > 0 ? Phaser.Math.Clamp(value / max, 0, 1) : 0;
    if (ratio !== this.ratio) {
      this.ratio = ratio;
      this.scene.tweens.killTweensOf(this.fill);
      this.scene.tweens.add({ targets: this.fill, scaleX: ratio, duration: 140 });
    }

    // setText re-lays out the glyphs, so only touch it when the string changes.
    const label = `${Math.ceil(value)} / ${Math.ceil(max)}`;
    if (label !== this.labelValue) {
      this.labelValue = label;
      this.label.setText(label);
    }
  }
}
