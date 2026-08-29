import Phaser from 'phaser';
import type { DojoStyleDef } from '../data/dojoStyles';
import { CLASSIC_DOJO_STYLE } from '../data/dojoStyles';
import { ATLAS_KEY } from '../render/atlasConfig';

export interface PanelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Shared carved-wood panel frame with brass inlay and an attached title plaque.
 * The atlas bezel supplies pixel texture; code-native inlay keeps it warm and
 * dimensional at every responsive size without stretching a decorative corner.
 */
export class PanelChrome extends Phaser.GameObjects.Container {
  private readonly shadow: Phaser.GameObjects.Graphics;
  private readonly bezel: Phaser.GameObjects.NineSlice;
  private readonly inlay: Phaser.GameObjects.Graphics;
  private readonly plaqueShadow: Phaser.GameObjects.Graphics;
  private readonly plaque: Phaser.GameObjects.NineSlice;
  private readonly plaqueInlay: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.BitmapText;
  private readonly corners: Phaser.GameObjects.Graphics[];
  private rect: PanelRect;
  private style: DojoStyleDef = CLASSIC_DOJO_STYLE;

  constructor(scene: Phaser.Scene, rect: PanelRect, title: string, depth: number) {
    super(scene, rect.x + rect.w / 2, rect.y + rect.h / 2);
    scene.add.existing(this).setDepth(depth);
    this.rect = { ...rect };

    this.shadow = scene.add.graphics();
    this.bezel = scene.add.nineslice(0, 0, ATLAS_KEY, 'frame_bezel', rect.w, rect.h, 20, 20, 20, 20);
    this.inlay = scene.add.graphics();
    this.plaqueShadow = scene.add.graphics();
    this.plaque = scene.add.nineslice(0, 0, ATLAS_KEY, 'banner_name_9', 230, 46, 11, 11, 7, 7);
    this.plaqueInlay = scene.add.graphics();
    this.label = scene.add.bitmapText(0, 0, 'pixel', title, 18).setOrigin(0.5).setTint(0xf7ead1);
    this.corners = [
      scene.add.graphics(),
      scene.add.graphics(),
      scene.add.graphics(),
      scene.add.graphics(),
    ];
    this.add([
      this.shadow,
      this.bezel,
      this.inlay,
      ...this.corners,
      this.plaqueShadow,
      this.plaque,
      this.plaqueInlay,
      this.label,
    ]);
    this.redraw();
  }

  setTitle(title: string): void {
    if (this.label.text !== title) this.label.setText(title);
  }

  applyDojoStyle(style: DojoStyleDef): void {
    this.style = style;
    this.redraw();
  }

  relayout(rect: PanelRect): void {
    this.rect = { ...rect };
    this.setPosition(rect.x + rect.w / 2, rect.y + rect.h / 2);
    this.redraw();
  }

  private redraw(): void {
    const { w, h } = this.rect;
    const p = this.style.palette;
    const halfW = w / 2;
    const halfH = h / 2;
    const plaqueW = Phaser.Math.Clamp(Math.round(w * 0.34), 210, 274);
    const plaqueY = -halfH - 1;

    this.shadow
      .clear()
      .lineStyle(16, 0x050608, 0.64)
      .strokeRoundedRect(-halfW - 2, -halfH + 4, w + 4, h + 2, 8);
    this.bezel.setSize(w, h).setTint(p.frame);

    this.inlay
      .clear()
      .lineStyle(2, p.accent, 0.96)
      .strokeRoundedRect(-halfW + 8, -halfH + 8, w - 16, h - 16, 5)
      .lineStyle(1, p.accentBright, 0.48)
      .strokeRoundedRect(-halfW + 13, -halfH + 13, w - 26, h - 26, 3)
      .lineStyle(5, p.panelDark, 0.76)
      .lineBetween(-halfW + 27, -halfH + 17, halfW - 27, -halfH + 17);

    // Compact code-native brass caps. The packed atlas's old corner frames
    // are intentionally blank, so these preserve a crisp pixel-art corner
    // without resurrecting dead texture data or stretching an ornament.
    this.corners.forEach((corner) => {
      corner
        .clear()
        .lineStyle(3, p.accent, 0.94)
        .lineBetween(0, 16, 0, 0)
        .lineBetween(0, 0, 16, 0)
        .lineStyle(1, p.accentBright, 0.8)
        .lineBetween(4, 12, 4, 4)
        .lineBetween(4, 4, 12, 4)
        .fillStyle(p.accentBright, 0.9)
        .fillRect(1, 1, 3, 3);
    });
    const inset = 7;
    this.corners[0]?.setPosition(-halfW + inset, -halfH + inset).setScale(1, 1);
    this.corners[1]?.setPosition(halfW - inset, -halfH + inset).setScale(-1, 1);
    this.corners[2]?.setPosition(-halfW + inset, halfH - inset).setScale(1, -1);
    this.corners[3]?.setPosition(halfW - inset, halfH - inset).setScale(-1, -1);

    this.plaqueShadow
      .clear()
      .fillStyle(0x050608, 0.62)
      .fillRoundedRect(-plaqueW / 2 - 5, plaqueY - 18, plaqueW + 10, 44, 5);
    this.plaque.setPosition(0, plaqueY).setSize(plaqueW, 44).setTint(p.panel);
    this.plaqueInlay
      .clear()
      .lineStyle(2, p.accent, 1)
      .strokeRoundedRect(-plaqueW / 2 + 5, plaqueY - 18, plaqueW - 10, 36, 4)
      .lineStyle(1, p.accentBright, 0.44)
      .lineBetween(-plaqueW / 2 + 17, plaqueY - 13, plaqueW / 2 - 17, plaqueY - 13);
    this.label.setPosition(0, plaqueY + 1).setTint(this.style.id === 'crimson-dojo' ? 0xfff1cf : 0xf7ead1);
  }
}
