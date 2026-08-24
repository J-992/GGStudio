import Phaser from 'phaser';
import type { GameCore } from '../core/GameCore';
import { ATLAS_KEY } from '../render/atlasConfig';
import type { Sfx } from '../audio/Sfx';
import { theme } from './theme';

/** How long the armed confirm stays open before quietly collapsing. */
const CONFIRM_WINDOW_MS = 4000;

/**
 * The optional prestige offer: a small star on the roster rail that only
 * exists once the run has outlived its ladder.
 *
 * It is deliberately not a modal -- no shade, no popup, no forced choice, in
 * keeping with a game whose whole identity is zero punishment. The first tap
 * only arms the button; ascending needs a second tap inside the window, and
 * doing nothing lets it fold back into the rail. The confirm timer runs on
 * wall-clock time (`window.setTimeout`), never `scene.time.delayedCall`:
 * hit-stop scales that clock and once stretched a 55 ms restore into seconds.
 */
export class AscensionButton extends Phaser.GameObjects.Container {
  private readonly plate: Phaser.GameObjects.NineSlice;
  private readonly star: Phaser.GameObjects.Image;
  private readonly label: Phaser.GameObjects.BitmapText;
  private readonly hint: Phaser.GameObjects.BitmapText;
  private armed = false;
  private collapseTimer: number | null = null;

  constructor(
    private readonly sceneRef: Phaser.Scene,
    private readonly core: GameCore,
    private readonly sfx: Sfx,
  ) {
    super(sceneRef, 0, 0);
    sceneRef.add.existing(this).setDepth(9).setVisible(false);

    this.plate = sceneRef.add.nineslice(0, 0, ATLAS_KEY, 'banner_name_9', 56, 56, 11, 11, 7, 7).setTint(0xb9862f);
    this.star = sceneRef.add.image(0, 0, ATLAS_KEY, 'fx_star').setScale(1.5).setTint(0xffe07a);
    this.label = sceneRef.add.bitmapText(0, 0, 'pixel', 'ASCEND?', 14).setOrigin(0.5).setScale(1.4).setTint(0xfff6dd);
    this.hint = sceneRef.add.bitmapText(0, 0, 'pixel', 'TAP AGAIN TO BEGIN ANEW', 14).setOrigin(0.5).setTint(0x3a2a12);
    // The pressable thing is the plate itself, never the container (see the
    // settings panel: input on containers falls through to what is behind).
    this.plate.setInteractive(new Phaser.Geom.Rectangle(-8, -8, 72, 72), Phaser.Geom.Rectangle.Contains);
    this.plate.on('pointerdown', () => this.press());
    this.add([this.plate, this.star, this.label, this.hint]);
    this.collapse();
    this.relayout();
  }

  /** Cheap per-frame state check: visible only while an ascension is on offer. */
  refresh(): void {
    const show = this.core.canAscend;
    if (show === this.visible) return;
    if (show) {
      this.collapse();
      this.setVisible(true).setAlpha(0).setScale(0.6);
      this.sceneRef.tweens.add({ targets: this, alpha: 1, scale: 1, duration: 240, ease: 'Back.easeOut' });
    } else {
      this.disarm();
      this.setVisible(false);
    }
  }

  relayout(): void {
    const a = theme.layout.ascension;
    this.setPosition(a.x, a.y);
    if (!this.armed) {
      this.plate.setSize(56, 56).setPosition(0, 0);
      this.plate.setInteractive(new Phaser.Geom.Rectangle(-8, -8, 72, 72), Phaser.Geom.Rectangle.Contains);
      this.star.setPosition(0, 0);
      this.label.setPosition(0, -14).setVisible(false);
      this.hint.setPosition(0, 0).setVisible(false);
      return;
    }
    // Armed: the offer unfolds to the RIGHT along the button row. It must
    // never rise into the panel title above nor reach left over the gear.
    const starHalf = 28;
    const labelX = starHalf + this.label.width / 2 + 8;
    const hintX = starHalf + this.label.width + 14 + this.hint.width / 2;
    const plateWidth = Math.ceil(hintX + this.hint.width / 2 + 14 + starHalf);
    this.plate.setSize(plateWidth, 56).setPosition(plateWidth / 2 - starHalf, 0);
    // Written in the plate's own local frame (top-left-anchored, per Phaser's
    // displayOrigin shift -- see BuyButton's fix): the plate's displayOriginX
    // is plateWidth / 2 regardless of where setPosition moved it, so an
    // `-starHalf` term here doesn't cancel anything and instead pushes the
    // whole hit rect starHalf px left, opening a dead zone on the right end
    // (right where the "TAP AGAIN" hint text sits).
    this.plate.setInteractive(new Phaser.Geom.Rectangle(-8, -36, plateWidth + 16, 72), Phaser.Geom.Rectangle.Contains);
    this.star.setPosition(0, 0);
    this.label.setPosition(labelX, 0).setVisible(true);
    this.hint.setPosition(hintX, 0).setVisible(true);
  }

  anchors(): { star: { x: number; y: number }; confirm: { x: number; y: number } } {
    const p = (x: number, y: number) => {
      const rect = this.sceneRef.game.canvas.getBoundingClientRect();
      return {
        x: rect.left + window.scrollX + (this.x + x) * rect.width / theme.layout.width,
        y: rect.top + window.scrollY + (this.y + y) * rect.height / theme.layout.height,
      };
    };
    // While armed the whole widened plate confirms, so aim at its centre.
    return { star: p(0, 0), confirm: p(this.armed ? 60 : 34, 0) };
  }

  private press(): void {
    this.sfx.unlock();
    this.sfx.play('click');
    if (!this.core.canAscend) return;
    // The modal guard lives in the scene: while a reveal or panel is open,
    // presses never reach here at all, so no extra check is needed.
    if (!this.armed) {
      this.arm();
      return;
    }
    this.disarm();
    this.sceneRef.tweens.add({
      targets: this,
      scale: { from: 1, to: 0.82 },
      yoyo: true,
      duration: 110,
      onComplete: () => this.core.ascend(),
    });
  }

  private arm(): void {
    this.armed = true;
    this.relayout();
    // Only the star turns: the plate must stay axis-aligned or its input
    // area swings away from where a finger aims.
    this.sceneRef.tweens.add({ targets: this.star, angle: 360, duration: 640, ease: 'Quad.easeOut' });
    this.sceneRef.tweens.add({ targets: this.star, scale: 1.9, duration: 700, yoyo: true, repeat: -1 });
    // Wall-clock on purpose: hit-stop slows the scene clock, and an armed
    // confirm must collapse on time regardless.
    this.collapseTimer = window.setTimeout(() => {
      this.collapseTimer = null;
      this.collapse();
    }, CONFIRM_WINDOW_MS);
  }

  private disarm(): void {
    this.armed = false;
    if (this.collapseTimer !== null) {
      window.clearTimeout(this.collapseTimer);
      this.collapseTimer = null;
    }
  }

  /** Fold back to the plain star and stop the pulse. */
  private collapse(): void {
    this.disarm();
    this.sceneRef.tweens.killTweensOf(this.star);
    this.star.setAngle(0);
    this.star.setScale(1.5);
    this.relayout();
  }

  /** Destroy-time hygiene: no timer may outlive the widget. */
  override destroy(...args: Parameters<Phaser.GameObjects.Container['destroy']>): void {
    this.disarm();
    super.destroy(...args);
  }
}
