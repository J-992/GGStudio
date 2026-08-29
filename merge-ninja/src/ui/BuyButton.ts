import Phaser from 'phaser';
import { ATLAS_KEY } from '../render/atlasConfig';
import { compactNumber, theme } from './theme';
import type { Fx } from '../effects/Fx';
import type { Sfx } from '../audio/Sfx';
import { CLASSIC_DOJO_STYLE, type DojoStyleDef } from '../data/dojoStyles';

/** Minimum touch-target height for the buy button, in design pixels. */
const MIN_HIT_HEIGHT = 96;

export class BuyButton extends Phaser.GameObjects.Container {
  private readonly buttonBody: Phaser.GameObjects.Graphics;
  private readonly buttonSheen: Phaser.GameObjects.Graphics;
  private readonly buyLabel: Phaser.GameObjects.BitmapText;
  private readonly costLabel: Phaser.GameObjects.BitmapText;
  private readonly coin: Phaser.GameObjects.Image;
  private renderState = '';
  private wasAvailable: boolean | null = null;
  private available = false;
  private hovered = false;
  private style: DojoStyleDef = CLASSIC_DOJO_STYLE;
  constructor(scene: Phaser.Scene, onBuy: () => void, private readonly fx: Fx, private readonly sfx: Sfx) {
    const r = theme.layout.buy;
    super(scene, r.x, r.y); scene.add.existing(this).setDepth(8);
    this.buttonBody = scene.add.graphics();
    this.buttonSheen = scene.add.graphics();
    this.buyLabel = scene.add.bitmapText(0, -11, 'pixel', '', 15).setOrigin(.5).setTint(0xf8ebd0);
    this.coin = scene.add.image(-23, 14, ATLAS_KEY, 'icon_coin').setScale(1.12);
    this.costLabel = scene.add.bitmapText(1, 14, 'pixel', '', 13).setOrigin(0, .5).setTint(0xf8ebd0);
    this.add([this.buttonBody, this.buttonSheen, this.buyLabel, this.coin, this.costLabel]);
    // The touch target is taller than the art (>= 96 design px, centred on the
    // button) so little fingers land it without aiming; the visible green
    // rectangle keeps its tuned size and position.
    const hitHeight = Math.max(r.h, MIN_HIT_HEIGHT);
    // Phaser tests a custom hit area against the pointer AFTER shifting it by
    // the object's own displayOrigin (InputManager.pointWithinHitArea), so a
    // rectangle here has to be written top-left-anchored (0, 0, w, h) --
    // centering it at (-w/2, -h/2) double-applies that shift and silently
    // halves the clickable region onto the button's left side only.
    this.setSize(r.w, hitHeight).setInteractive(
      new Phaser.Geom.Rectangle(0, 0, r.w, hitHeight),
      Phaser.Geom.Rectangle.Contains,
    );
    this.on('pointerover', () => {
      if (!this.available || this.hovered) return;
      this.hovered = true;
      this.scene.tweens.add({ targets: this, y: theme.layout.buy.y - 2, duration: theme.motion.hoverMs, ease: 'Quad.easeOut' });
      this.redrawSurface();
    });
    this.on('pointerout', () => {
      if (!this.hovered) return;
      this.hovered = false;
      this.scene.tweens.add({ targets: this, y: theme.layout.buy.y, duration: theme.motion.hoverMs, ease: 'Quad.easeOut' });
      this.redrawSurface();
    });
    // The press flash lands under the finger, not in the middle of the button:
    // on a 230px-wide button a centred burst reads as unrelated to the tap.
    this.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.scene.tweens.add({ targets: this, scale: .965, yoyo: true, duration: theme.motion.pressMs / 2 });
      if (this.available) this.fx.mergeFlash(pointer.worldX, pointer.worldY);
      this.sfx.play('click');
      onBuy();
    });
    this.redrawSurface();
  }
  refresh(tier: number, cost: number, canBuy: boolean): void {
    const becameAvailable = this.wasAvailable === false && canBuy;
    this.wasAvailable = canBuy;
    const state = `${tier}:${cost}:${canBuy}`; if (this.renderState === state) return;
    this.renderState = state; this.available = canBuy; this.buyLabel.setText(`BUY LV.${tier}`); this.costLabel.setText(compactNumber(cost));
    this.redrawSurface();
    if (becameAvailable) this.pulse();
  }
  applyDojoStyle(style: DojoStyleDef): void {
    this.style = style;
    this.renderState = '';
    this.redrawSurface();
  }
  relayout(): void {
    const r = theme.layout.buy;
    this.setPosition(r.x, r.y);
    this.redrawSurface();
    // The invisible hit area keeps its >= 96px height across relayouts.
    const hitHeight = Math.max(r.h, MIN_HIT_HEIGHT);
    this.setSize(r.w, hitHeight);
    if (this.input !== null) {
      this.input.hitArea.setTo(0, 0, r.w, hitHeight);
    }
  }
  pulse(): void { if (this.scene.tweens.isTweening(this)) return; this.scene.tweens.add({ targets: this, scaleX: 1.06, scaleY: 1.06, yoyo: true, repeat: 2, duration: 130 }); }
  /**
   * "Not enough coins" feedback: the button shakes its head, the price flares
   * red, and a floater spells out exactly how much is missing. Without this
   * the tap reads as a broken button rather than a rejected purchase.
   */
  reject(shortfall: string): void {
    this.scene.tweens.add({ targets: this, x: this.x - 6, yoyo: true, repeat: 3, duration: 45, ease: 'Sine.easeInOut', onComplete: () => this.setPosition(theme.layout.buy.x, theme.layout.buy.y) });
    this.coin.setTint(0xff6b57); this.costLabel.setTint(0xff8f7a);
    this.scene.time.delayedCall(320, () => { this.coin.clearTint(); this.costLabel.setTint(0xffffff); });
    const r = theme.layout.buy;
    const note = this.scene.add.bitmapText(r.x, r.y - r.h / 2 - 18, 'pixel', `NEED ${shortfall} MORE`, 14)
      .setOrigin(.5).setTint(0xff8f7a).setDepth(60).setScale(1.4);
    this.scene.tweens.add({ targets: note, y: note.y - 44, alpha: 0, duration: 720, ease: 'Quad.easeOut', onComplete: () => note.destroy() });
  }

  private redrawSurface(): void {
    const r = theme.layout.buy;
    const enabled = this.available;
    const body = enabled ? this.style.palette.buy : theme.colors.buyDisabled;
    const edge = enabled ? this.style.palette.buyStroke : 0x756b5f;
    const top = enabled ? (this.hovered ? 0xa8663d : 0x925334) : 0x5c544c;
    this.buttonBody
      .clear()
      .fillStyle(0x050506, 0.58)
      .fillRoundedRect(-r.w / 2 + 2, -r.h / 2 + 5, r.w, r.h, 7)
      .fillStyle(edge, 1)
      .fillRoundedRect(-r.w / 2, -r.h / 2, r.w, r.h, 7)
      .fillStyle(body, 1)
      .fillRoundedRect(-r.w / 2 + 4, -r.h / 2 + 4, r.w - 8, r.h - 8, 5)
      .lineStyle(1, this.style.palette.accentBright, enabled ? 0.58 : 0.2)
      .strokeRoundedRect(-r.w / 2 + 7, -r.h / 2 + 7, r.w - 14, r.h - 14, 3);
    this.buttonSheen
      .clear()
      .fillStyle(top, enabled ? 0.48 : 0.24)
      .fillRoundedRect(-r.w / 2 + 9, -r.h / 2 + 8, r.w - 18, Math.max(7, r.h * 0.22), 3);
    this.setAlpha(enabled ? 1 : 0.76);
  }
}
