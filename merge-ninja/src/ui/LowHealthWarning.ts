import Phaser from 'phaser';
import { theme } from './theme';

/** Texture keys for the two one-pixel-wide gradients the border is built from. */
const GLOW_V = 'fx_edge_glow_v';
const GLOW_H = 'fx_edge_glow_h';
const GLOW_STEPS = 64;

/** How far the red reaches in from each edge, as a share of the short side. */
const BAND_SHARE = 0.17;

/**
 * The red pulse around the screen when the line is nearly out.
 *
 * Four soft-edged bands rather than a solid frame: a hard border reads as a
 * broken layout, while a glow that breathes reads as danger without hiding any
 * of the board underneath it. Nothing here is interactive -- the warning must
 * never eat a tap aimed at a merge.
 */
export class LowHealthWarning extends Phaser.GameObjects.Container {
  private readonly edges: Phaser.GameObjects.Image[];
  private pulse: Phaser.Tweens.Tween | null = null;
  private showing = false;

  constructor(private readonly sceneRef: Phaser.Scene) {
    super(sceneRef, 0, 0);
    sceneRef.add.existing(this).setDepth(320).setVisible(false);

    LowHealthWarning.ensureTextures(sceneRef);
    this.edges = [
      sceneRef.add.image(0, 0, GLOW_V).setOrigin(0.5, 0),
      sceneRef.add.image(0, 0, GLOW_V).setOrigin(0.5, 1).setFlipY(true),
      sceneRef.add.image(0, 0, GLOW_H).setOrigin(0, 0.5),
      sceneRef.add.image(0, 0, GLOW_H).setOrigin(1, 0.5).setFlipX(true),
    ];
    for (const edge of this.edges) edge.setTint(0xff2d2d).setBlendMode(Phaser.BlendModes.ADD);
    this.add(this.edges);
    this.relayout();
  }

  get isShowing(): boolean {
    return this.showing;
  }

  /** Drive straight from the model each frame; the widget owns no state. */
  setDanger(danger: boolean): void {
    if (danger === this.showing) return;
    this.showing = danger;
    this.pulse?.remove();
    this.pulse = null;

    if (!danger) {
      this.sceneRef.tweens.add({
        targets: this,
        alpha: 0,
        duration: 220,
        onComplete: () => this.setVisible(false),
      });
      return;
    }

    this.setVisible(true).setAlpha(0);
    this.pulse = this.sceneRef.tweens.add({
      targets: this,
      alpha: { from: 0.35, to: 1 },
      duration: 520,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  relayout(): void {
    const l = theme.layout;
    const band = Math.round(Math.min(l.width, l.height) * BAND_SHARE);
    const [top, bottom, left, right] = this.edges as [
      Phaser.GameObjects.Image, Phaser.GameObjects.Image, Phaser.GameObjects.Image, Phaser.GameObjects.Image,
    ];
    top.setPosition(l.width / 2, 0).setDisplaySize(l.width, band);
    bottom.setPosition(l.width / 2, l.height).setDisplaySize(l.width, band);
    left.setPosition(0, l.height / 2).setDisplaySize(band, l.height);
    right.setPosition(l.width, l.height / 2).setDisplaySize(band, l.height);
  }

  /**
   * One pixel column and one pixel row, opaque at the screen edge and clear a
   * band's width in. Stretching those beats four flat rectangles: a hard inner
   * edge is what makes an overlay look like a bug rather than a warning.
   */
  private static ensureTextures(scene: Phaser.Scene): void {
    if (scene.textures.exists(GLOW_V)) return;

    for (const [key, vertical] of [[GLOW_V, true], [GLOW_H, false]] as const) {
      const width = vertical ? 1 : GLOW_STEPS;
      const height = vertical ? GLOW_STEPS : 1;
      const texture = scene.textures.createCanvas(key, width, height);
      const context = texture?.getContext();
      if (texture === null || texture === undefined || context === null || context === undefined) continue;

      const gradient = context.createLinearGradient(0, 0, vertical ? 0 : GLOW_STEPS, vertical ? GLOW_STEPS : 0);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.45, 'rgba(255,255,255,0.30)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
      texture.refresh();
    }
  }
}
