import Phaser from 'phaser';
import type { DojoStyleDef } from '../data/dojoStyles';
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
  private danger = false;
  private enraged = false;
  /** Colour an enraged boss paints the edges. Follows the equipped dojo skin. */
  private enrageTint = 0xd66ac5;

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
    this.danger = danger;
    this.sync();
  }

  /**
   * An enraged boss lights the same edges, in the skin's own aura colour.
   *
   * Deliberately this widget rather than a second overlay: the player has
   * already learned that a pulsing border means "the arena wants something
   * from you", and inventing a second danger colour would spend that lesson
   * to say the same thing twice. Low health still wins the colour when both
   * are true, because that one is about losing the run.
   */
  setEnraged(enraged: boolean): void {
    this.enraged = enraged;
    this.sync();
  }

  applyDojoStyle(style: DojoStyleDef): void {
    this.enrageTint = style.palette.bossAura;
    if (this.showing && !this.danger) this.paint(this.enrageTint);
  }

  private sync(): void {
    const wanted = this.danger || this.enraged;
    if (wanted) this.paint(this.danger ? 0xff2d2d : this.enrageTint);
    if (wanted === this.showing) return;
    this.showing = wanted;
    this.pulse?.remove();
    this.pulse = null;

    if (!wanted) {
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
      // An enraged boss breathes slower and dimmer than a dying line: it is a
      // problem to solve, not a run about to end.
      alpha: this.danger ? { from: 0.35, to: 1 } : { from: 0.18, to: 0.6 },
      duration: this.danger ? 520 : 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private paint(tint: number): void {
    for (const edge of this.edges) edge.setTint(tint);
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
