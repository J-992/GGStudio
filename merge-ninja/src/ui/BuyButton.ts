import Phaser from 'phaser';
import { ATLAS_KEY } from '../render/atlasConfig';
import { compactNumber, theme } from './theme';
import type { Fx } from '../effects/Fx';
import type { Sfx } from '../audio/Sfx';

/** Minimum touch-target height for the buy button, in design pixels. */
const MIN_HIT_HEIGHT = 96;

export class BuyButton extends Phaser.GameObjects.Container {
  private readonly buttonBody: Phaser.GameObjects.Rectangle;
  private readonly buttonSheen: Phaser.GameObjects.Rectangle;
  private readonly buyLabel: Phaser.GameObjects.BitmapText;
  private readonly costLabel: Phaser.GameObjects.BitmapText;
  private readonly coin: Phaser.GameObjects.Image;
  private renderState = '';
  private wasAvailable: boolean | null = null;
  constructor(scene: Phaser.Scene, onBuy: () => void, private readonly fx: Fx, private readonly sfx: Sfx) {
    const r = theme.layout.buy;
    super(scene, r.x, r.y); scene.add.existing(this).setDepth(8);
    // A solid fill, not the tinted brown plate: multiplying dark art by green
    // can only ever land somewhere muddy, and this button has to pop.
    this.buttonBody = scene.add.rectangle(0, 0, r.w, r.h, theme.colors.buy).setStrokeStyle(5, 0x14520f);
    this.buttonSheen = scene.add.rectangle(0, -r.h / 4, r.w - 24, r.h / 4, 0xffffff, .15);
    this.buyLabel = scene.add.bitmapText(0, -12, 'pixel', '', 14).setOrigin(.5).setTint(0xffffff);
    this.coin = scene.add.image(-24, 14, ATLAS_KEY, 'icon_coin');
    this.costLabel = scene.add.bitmapText(2, 14, 'pixel', '', 14).setOrigin(0, .5).setTint(0xffffff);
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
    // The press flash lands under the finger, not in the middle of the button:
    // on a 230px-wide button a centred burst reads as unrelated to the tap.
    this.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.scene.tweens.add({ targets: this, scale: .94, yoyo: true, duration: 75 });
      this.fx.mergeFlash(pointer.worldX, pointer.worldY);
      this.sfx.play('click');
      onBuy();
    });
  }
  refresh(tier: number, cost: number, canBuy: boolean): void {
    const becameAvailable = this.wasAvailable === false && canBuy;
    this.wasAvailable = canBuy;
    const state = `${tier}:${cost}:${canBuy}`; if (this.renderState === state) return;
    this.renderState = state; this.buyLabel.setText(`BUY LV.${tier}`); this.costLabel.setText(compactNumber(cost));
    this.buttonBody.setFillStyle(canBuy ? theme.colors.buy : theme.colors.buyDisabled);
    this.buttonBody.setStrokeStyle(5, canBuy ? 0x14520f : 0x4a4f49);
    if (becameAvailable) this.pulse();
  }
  relayout(): void {
    const r = theme.layout.buy;
    this.setPosition(r.x, r.y);
    this.buttonBody.setSize(r.w, r.h);
    this.buttonSheen.setPosition(0, -r.h / 4).setSize(r.w - 24, r.h / 4);
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
}
