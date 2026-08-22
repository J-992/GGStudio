import Phaser from 'phaser';
import { ninjaDef } from '../data/ninjas';
import { ninjaIdleFrameAt } from '../data/presentation';
import type { GameCore } from '../core/GameCore';
import { FLAME_SHOGUN_TIER, ninjaCatalogPortrait } from '../render/atlasConfig';
import { REVEAL_ASSETS, revealNinjaRig } from '../render/revealAssets';
import type { RevealNinjaRig } from '../render/revealAssets';
import { VFX_ANIMATIONS } from '../data/vfxAssets';
import { theme } from './theme';

const BEAT = { charge: 140, burst: 620, settle: 760 } as const;
const EXIT_MS = 220;
const SHADE_ALPHA = 0.88;

interface Drama {
  rays: number;
  rayAlpha: number;
  sparks: number;
  flames: number;
  portal: boolean;
  doubleRing: boolean;
  punch: boolean;
  shakeMs: number;
  shakeIntensity: number;
  holdMs: number;
  gold: boolean;
}

const MODEST: Drama = { rays: 10, rayAlpha: 0.5, sparks: 10, flames: 0, portal: false, doubleRing: false, punch: false, shakeMs: 150, shakeIntensity: 0.008, holdMs: 4600, gold: false };
const RICH: Drama = { rays: 14, rayAlpha: 0.72, sparks: 16, flames: 0, portal: false, doubleRing: false, punch: true, shakeMs: 200, shakeIntensity: 0.011, holdMs: 4600, gold: false };
const FLAMED: Drama = { rays: 16, rayAlpha: 0.8, sparks: 18, flames: 6, portal: true, doubleRing: false, punch: true, shakeMs: 220, shakeIntensity: 0.013, holdMs: 5200, gold: false };
const ULTIMATE: Drama = { rays: 20, rayAlpha: 0.9, sparks: 24, flames: 8, portal: true, doubleRing: true, punch: true, shakeMs: 260, shakeIntensity: 0.016, holdMs: 6400, gold: true };

const dramaFor = (tier: number): Drama => (tier >= 25 ? ULTIMATE : tier >= 18 ? FLAMED : tier >= 5 ? RICH : MODEST);

const mixColor = (a: number, b: number, t: number): number => {
  const c = Phaser.Display.Color.Interpolate.ColorWithColor(
    Phaser.Display.Color.IntegerToColor(a),
    Phaser.Display.Color.IntegerToColor(b),
    100,
    Math.round(Phaser.Math.Clamp(t, 0, 1) * 100),
  );
  return Phaser.Display.Color.GetColor(c.r, c.g, c.b);
};

export class NinjaReveal extends Phaser.GameObjects.Container {
  private readonly shade: Phaser.GameObjects.Rectangle;
  private readonly flash: Phaser.GameObjects.Rectangle;
  private readonly card: Phaser.GameObjects.Container;
  private readonly underPlate: Phaser.GameObjects.Rectangle;
  private readonly panel: Phaser.GameObjects.Image;
  private readonly trimT: Phaser.GameObjects.Rectangle;
  private readonly trimB: Phaser.GameObjects.Rectangle;
  private readonly trimL: Phaser.GameObjects.Rectangle;
  private readonly trimR: Phaser.GameObjects.Rectangle;
  private readonly glow: Phaser.GameObjects.Image;
  private readonly portal: Phaser.GameObjects.Sprite;
  private readonly rays: Phaser.GameObjects.Graphics;
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private readonly plinth: Phaser.GameObjects.Image;
  private readonly flames: Phaser.GameObjects.Sprite[] = [];
  private readonly hero: Phaser.GameObjects.Sprite;
  private readonly banner: Phaser.GameObjects.Container;
  private readonly bannerPlate: Phaser.GameObjects.Image;
  private readonly bannerLabel: Phaser.GameObjects.BitmapText;
  private readonly info: Phaser.GameObjects.Container;
  private readonly badgePlate: Phaser.GameObjects.Image;
  private readonly badgeNum: Phaser.GameObjects.BitmapText;
  private readonly nameText: Phaser.GameObjects.BitmapText;
  private readonly dpsText: Phaser.GameObjects.BitmapText;
  private readonly button: Phaser.GameObjects.Container;
  private readonly buttonGlow: Phaser.GameObjects.Arc;
  private readonly buttonBody: Phaser.GameObjects.Image;
  private readonly buttonText: Phaser.GameObjects.BitmapText;
  private readonly ringA: Phaser.GameObjects.Sprite;
  private readonly ringB: Phaser.GameObjects.Sprite;
  private readonly sparkles: Phaser.GameObjects.Sprite[] = [];
  private readonly queue: number[] = [];
  private readonly scheduled: number[] = [];
  private current: number | null = null;
  private resumeSpeed = 1;
  private dismissing = false;
  private ignoreNextPointerUp = false;
  private exitToken = 0;
  private settled = false;
  private heroShown = false;
  private heroFrameAnim = false;
  private heroMultiplier = 2.5;
  private heroDrawScale = 2.5;
  private heroRig: RevealNinjaRig = revealNinjaRig(1);
  private heroFootY = 0;
  private heroCY = 0;
  private heroZone = 300;
  private accent = 0xf0b93f;
  private drama: Drama = MODEST;
  private cardW = 600;
  private cardH = 700;
  private infoY = 174;
  private bannerY = -308;
  private plinthTopY = 0;
  private portalBaseScale = 3;
  private rayLen = 300;
  private raySquash = 0.7;
  private haloBaseScale = 1;

  constructor(private readonly sceneRef: Phaser.Scene, private readonly core: GameCore) {
    super(sceneRef, 0, 0);
    sceneRef.add.existing(this).setDepth(500).setVisible(false);
    const l = theme.layout;

    this.shade = sceneRef.add.rectangle(l.width / 2, l.height / 2, l.width, l.height, 0x05090f, SHADE_ALPHA).setInteractive();
    this.flash = sceneRef.add.rectangle(l.width / 2, l.height / 2, l.width, l.height, 0xffffff, 0).setVisible(false);

    this.underPlate = sceneRef.add.rectangle(0, 0, 100, 100, 0x16100b);
    this.panel = sceneRef.add.image(0, 0, REVEAL_ASSETS.backdrop.key);
    this.trimT = sceneRef.add.rectangle(0, 0, 10, 6, 0xffffff);
    this.trimB = sceneRef.add.rectangle(0, 0, 10, 6, 0xffffff);
    this.trimL = sceneRef.add.rectangle(0, 0, 6, 10, 0xffffff);
    this.trimR = sceneRef.add.rectangle(0, 0, 6, 10, 0xffffff);
    this.glow = sceneRef.add.image(0, 0, REVEAL_ASSETS.halo.key).setAlpha(0.08);
    const portal = VFX_ANIMATIONS.portal;
    const flame = VFX_ANIMATIONS.flame;
    const shockwave = VFX_ANIMATIONS.shockwave;
    const merge = VFX_ANIMATIONS.merge;
    this.portal = sceneRef.add.sprite(0, 0, portal.textureKey, 0).setVisible(false).setAlpha(0);
    this.rays = sceneRef.add.graphics();
    this.shadow = sceneRef.add.ellipse(0, 0, 200, 40, 0x0a0705, 0.38);
    this.plinth = sceneRef.add.image(0, 0, REVEAL_ASSETS.plinth.key);
    for (let i = 0; i < 8; i += 1) {
      this.flames.push(sceneRef.add.sprite(0, 0, flame.textureKey, 0).setVisible(false).setAlpha(0));
    }

    this.hero = sceneRef.add.sprite(0, 0, ninjaDef(1).textureKey).setScale(0);

    this.bannerPlate = sceneRef.add.image(0, 0, REVEAL_ASSETS.banner.key);
    const bannerShadow = sceneRef.add.bitmapText(0, 3, 'pixel', 'NEW NINJA!', 14).setScale(2).setOrigin(0.5).setTint(0x2b1608);
    this.bannerLabel = sceneRef.add.bitmapText(0, 0, 'pixel', 'NEW NINJA!', 14).setScale(2).setOrigin(0.5).setTint(0xfff6dd);
    this.banner = sceneRef.add.container(0, 0, [this.bannerPlate, bannerShadow, this.bannerLabel]);

    this.badgePlate = sceneRef.add.image(0, 0, REVEAL_ASSETS.halo.key);
    this.badgeNum = sceneRef.add.bitmapText(0, 1, 'pixel', '', 14).setScale(2.2).setOrigin(0.5).setTint(0xfff6dd);
    this.nameText = sceneRef.add.bitmapText(0, 0, 'pixel', '', 14).setOrigin(0.5).setTint(0xffffff);
    this.dpsText = sceneRef.add.bitmapText(0, 30, 'pixel', '', 14).setOrigin(0.5, 0).setTint(0xffe9a8);
    this.info = sceneRef.add.container(0, 0, [this.badgePlate, this.badgeNum, this.nameText, this.dpsText]);

    this.buttonGlow = sceneRef.add.circle(0, 0, 150, 0x9de87e, 0.16);
    this.buttonBody = sceneRef.add.image(0, 0, REVEAL_ASSETS.button.key);
    const buttonTextShadow = sceneRef.add.bitmapText(0, 4, 'pixel', 'CONTINUE', 14).setScale(2).setOrigin(0.5).setTint(0x0f3a09);
    this.buttonText = sceneRef.add.bitmapText(0, 0, 'pixel', 'CONTINUE', 14).setScale(2).setOrigin(0.5).setTint(0xffffff);
    this.button = sceneRef.add
      .container(0, 0, [this.buttonGlow, this.buttonBody, buttonTextShadow, this.buttonText])
      .setSize(400, 96);
    this.buttonBody.setDisplaySize(360, 76).setInteractive(
      new Phaser.Geom.Rectangle(0, 0, this.buttonBody.width, this.buttonBody.height),
      Phaser.Geom.Rectangle.Contains,
    );

    this.ringA = sceneRef.add.sprite(0, 0, shockwave.textureKey, 0).setVisible(false).setAlpha(0);
    this.ringB = sceneRef.add.sprite(0, 0, shockwave.textureKey, 0).setVisible(false).setAlpha(0);

    for (let i = 0; i < 24; i += 1) {
      this.sparkles.push(sceneRef.add.sprite(0, 0, merge.textureKey, 0).setAlpha(0));
    }

    this.card = sceneRef.add.container(0, 0, [
      this.underPlate, this.panel, this.trimT, this.trimB, this.trimL, this.trimR,
      this.glow, this.portal, this.rays, this.shadow, this.plinth,
      ...this.flames, this.hero, this.banner, this.info, this.button,
    ]);
    this.add([this.shade, this.card, this.flash]);

    const dismissOnUp = (): void => {
      if (this.ignoreNextPointerUp) {
        this.ignoreNextPointerUp = false;
        return;
      }
      this.dismiss();
    };
    this.buttonBody.on('pointerup', dismissOnUp);
    this.shade.on('pointerup', dismissOnUp);

    sceneRef.events.on(Phaser.Scenes.Events.UPDATE, this.updateIdleFrame, this);
    this.relayout();
  }

  get isShowing(): boolean {
    return this.current !== null;
  }

  show(tier: number, openedPointerId?: number): void {
    if (tier < 2 || this.dismissing || !this.core.revealTier(tier)) return;
    this.queue.push(tier);
    if (this.current === null) this.showNext(openedPointerId);
  }

  relayout(): void {
    const l = theme.layout;
    this.cardW = l.landscape ? 720 : 600;
    this.cardH = l.landscape ? Math.min(560, l.height - 64) : Math.min(700, l.height - 140);
    const w = this.cardW;
    const h = this.cardH;

    this.card.setPosition(l.width / 2, l.height / 2);
    this.shade.setPosition(l.width / 2, l.height / 2).setSize(l.width, l.height);
    this.shade.setInteractive(new Phaser.Geom.Rectangle(0, 0, l.width, l.height), Phaser.Geom.Rectangle.Contains);
    this.flash.setPosition(l.width / 2, l.height / 2).setSize(l.width, l.height);

    this.underPlate.setSize(w + 22, h + 22);
    // Cover-crop the square shrine around its centre instead of stretching it.
    const source = 768;
    const targetRatio = w / h;
    if (targetRatio >= 1) {
      const cropH = source / targetRatio;
      this.panel.setCrop(0, (source - cropH) / 2, source, cropH);
    } else {
      const cropW = source * targetRatio;
      this.panel.setCrop((source - cropW) / 2, 0, cropW, source);
    }
    this.panel.setDisplaySize(w, h);
    const inset = 12;
    this.trimT.setPosition(0, -h / 2 + inset).setSize(w - inset * 2, 6);
    this.trimB.setPosition(0, h / 2 - inset).setSize(w - inset * 2, 6);
    this.trimL.setPosition(-w / 2 + inset, 0).setSize(6, h - inset * 2);
    this.trimR.setPosition(w / 2 - inset, 0).setSize(6, h - inset * 2);
    for (const trim of [this.trimT, this.trimB, this.trimL, this.trimR]) trim.setFillStyle(this.accent, 0.9);

    const bannerH = l.landscape ? 88 : 96;
    this.bannerY = -h / 2 + 54;
    this.banner.setPosition(0, this.settled ? this.bannerY : this.bannerY - 120);
    this.bannerPlate.setDisplaySize(Math.min(450, w - 84), bannerH);

    // A centred stack keeps the badge from pulling the name off-axis and
    // gives the plinth, stats, and button independent vertical zones.
    this.infoY = h / 2 - 160;
    this.info.setPosition(0, this.settled ? this.infoY : this.infoY + 14);
    this.badgePlate.setDisplaySize(58, 58).setPosition(0, -38);
    this.badgeNum.setPosition(0, -37);
    const raw = Math.max(1, this.nameText.width);
    const nameScale = Phaser.Math.Clamp((w - 96) / raw, 1, 2);
    this.nameText.setScale(nameScale).setPosition(0, 8);
    this.dpsText.setPosition(0, 36);

    this.button.setPosition(0, h / 2 - 54).setSize(360, 76);
    this.buttonBody.setDisplaySize(360, 76);
    this.buttonGlow.setDisplaySize(310, 68);

    this.heroFootY = this.infoY - 158;
    this.plinthTopY = this.heroFootY;
    const bannerBottom = this.bannerY + bannerH / 2 + 10;
    this.heroZone = Math.max(90, this.heroFootY - bannerBottom);
    this.heroDrawScale = Math.min(
      this.heroMultiplier,
      this.heroZone / Math.max(1, this.heroRig.h),
      (w - 100) / Math.max(1, this.heroRig.w),
    );
    this.heroCY = this.heroFootY - this.heroRig.h * this.heroDrawScale / 2;
    this.hero.setPosition(0, this.heroFootY);
    if (this.heroShown) {
      this.sceneRef.tweens.killTweensOf(this.hero);
      this.hero.setScale(this.heroDrawScale);
    }

    this.shadow.setPosition(0, this.heroFootY + 3).setSize(Math.min(300, this.heroDrawScale * this.heroRig.w * 0.82), 38);
    const plinthW = Math.min(w - 100, 430);
    this.plinth.setPosition(0, this.heroFootY + 29).setDisplaySize(plinthW, 96);

    this.glow.setPosition(0, this.heroCY);
    this.haloBaseScale = (this.heroZone * 1.08) / 384;
    if (!this.heroShown) this.glow.setScale(this.haloBaseScale * 0.5).setAlpha(0.08);
    this.portalBaseScale = Phaser.Math.Clamp(((this.heroZone + 120) * 0.95) / 256, 0.7, 1.8);
    this.portal.setPosition(0, this.heroCY);
    this.ringA.setPosition(0, this.heroCY);
    this.ringB.setPosition(0, this.heroCY);

    this.rayLen = Math.min(w * 0.5, 320);
    this.raySquash = Phaser.Math.Clamp((this.heroCY - bannerBottom + 24) / this.rayLen, 0.4, 1);
    this.rays.setPosition(0, this.heroCY);
    this.drawRays();

    for (let i = 0; i < this.flames.length; i += 1) {
      const lay = this.flameLayout(i);
      this.flames[i]?.setPosition(lay.x, lay.y);
    }
  }

  private showNext(openedPointerId?: number): void {
    const tier = this.queue.shift();
    if (tier === undefined) return;

    this.current = tier;
    this.ignoreNextPointerUp = openedPointerId !== undefined;
    this.resumeSpeed = this.core.speed;
    this.core.setSpeed(0);
    this.setVisible(true).setAlpha(1).setPosition(0, 0);

    const def = ninjaDef(tier);
    this.drama = dramaFor(tier);
    this.accent = def.accent;
    this.heroMultiplier = tier >= 25 ? 3.7 : tier >= 8 ? 3.25 : 2.5;
    this.heroFrameAnim = ninjaCatalogPortrait(tier)?.animation !== undefined;
    this.hero.stop();
    this.hero.setTexture(def.textureKey);
    this.heroRig = revealNinjaRig(tier);
    this.hero
      .setOrigin(
        (this.heroRig.x + this.heroRig.w / 2) / this.heroRig.frameW,
        (this.heroRig.y + this.heroRig.h) / this.heroRig.frameH,
      )
      .setTint(def.artTint).setScale(0).setAngle(0).setAlpha(1).setFrame(0);
    this.heroShown = false;
    this.settled = false;
    this.nameText.setText(def.name.toUpperCase());
    this.badgeNum.setText(String(tier));
    // Multi-digit tiers must stay inside the 58px halo plate: shrink from
    // the 2.2 showcase scale just enough that the widest glyph run clears
    // the starburst on both sides (44px of usable inner width).
    this.badgeNum.setScale(Math.min(2.2, 44 / Math.max(1, this.badgeNum.width)));
    this.dpsText.setText(this.powerLine(tier));
    this.relayout();

    this.shade.setAlpha(0);
    this.card.setScale(0.7).setAlpha(0);
    this.info.setAlpha(0);
    this.button.setAlpha(0).setScale(0.6);
    this.glow.setScale(this.haloBaseScale * 0.5).setAlpha(0.08);
    this.rays.setAlpha(0).setAngle(0);
    this.portal.setVisible(false).setAlpha(0);
    this.ringA.setVisible(false).setAlpha(0).setScale(0.25);
    this.ringB.setVisible(false).setAlpha(0).setScale(0.25);
    this.flash.setVisible(false).setFillStyle(0xffffff, 0);
    for (const flame of this.flames) flame.setVisible(false).setAlpha(0);
    for (const sparkle of this.sparkles) sparkle.setAlpha(0);

    this.sceneRef.tweens.add({ targets: this.shade, alpha: SHADE_ALPHA, duration: 240, ease: 'Quad.easeOut' });
    this.sceneRef.tweens.add({ targets: this.card, alpha: 1, scale: 1, duration: 380, ease: 'Back.easeOut' });

    this.after(BEAT.charge, () => this.charge());
    this.after(BEAT.burst, () => this.burst());
    this.after(BEAT.settle, () => this.settle());
    this.after(this.drama.holdMs, () => this.dismiss());
  }

  private powerLine(tier: number): string {
    const def = ninjaDef(tier);
    const prev = ninjaDef(Math.max(1, tier - 1));
    const ratio = def.dps / Math.max(1, prev.dps);
    const pct = Math.round((ratio - 1) * 100);
    if (pct <= 999) return `DPS +${pct}%`;
    return ratio >= 10 ? `DPS X${Math.round(ratio)}` : `DPS X${(Math.round(ratio * 10) / 10).toFixed(1)}`;
  }

  private flameLayout(index: number): { x: number; y: number; sx: number; sy: number } {
    const side = index % 2 === 0 ? -1 : 1;
    const row = Math.floor(index / 2);
    const plinthW = Math.min(this.cardW - 100, 430);
    return {
      x: side * (plinthW / 2 + 30 + (row % 2) * 24),
      y: this.plinthTopY + 20 - row * 34,
      sx: 0.34 + row * 0.03,
      sy: 0.52 + row * 0.05,
    };
  }

  private charge(): void {
    this.sceneRef.tweens.add({ targets: this.glow, alpha: 0.42, scale: this.haloBaseScale, duration: 420 });
    this.sceneRef.tweens.add({
      targets: [this.trimT, this.trimB],
      alpha: { from: 0.9, to: 0.35 },
      duration: 90,
      yoyo: true,
      repeat: 3,
      ease: 'Sine.easeInOut',
    });
    this.sparkles.forEach((sparkle, index) => {
      if (index >= this.drama.sparks) return;
      const angle = (Math.PI * 2 * index) / this.drama.sparks;
      const radius = 230 + (index % 3) * 40;
      sparkle
        .setPosition(
          Phaser.Math.Clamp(Math.cos(angle) * radius, -this.cardW / 2 + 24, this.cardW / 2 - 24),
          Phaser.Math.Clamp(this.heroCY + Math.sin(angle) * radius, -this.cardH / 2 + 24, this.infoY - 30),
        )
        .setAlpha(0.9)
        .setScale(0.14)
        .play(VFX_ANIMATIONS.merge.animationKey);
      this.sceneRef.tweens.add({
        targets: sparkle,
        x: 0,
        y: this.heroCY,
        alpha: 0,
        scale: 0.04,
        duration: 380,
        delay: (index % 5) * 40,
        ease: 'Quad.easeIn',
      });
    });
  }

  private burst(): void {
    const drama = this.drama;
    this.heroShown = true;

    this.sceneRef.tweens.add({ targets: this.hero, scale: this.heroDrawScale, duration: 380, ease: 'Back.easeOut' });

    this.flash.setVisible(true).setFillStyle(0xffffff, drama.gold ? 0.92 : drama.punch ? 0.82 : 0.66);
    this.sceneRef.tweens.add({ targets: this.flash, fillAlpha: 0, duration: 300, ease: 'Quad.easeOut', onComplete: () => this.flash.setVisible(false) });

    const ringTint = drama.gold ? 0xffe9a8 : mixColor(this.accent, 0xffffff, 0.6);
    this.ringA.setVisible(true).setAlpha(0.95).setScale(0.14).setTint(ringTint).play(VFX_ANIMATIONS.shockwave.animationKey);
    this.sceneRef.tweens.add({ targets: this.ringA, scale: 1.05, alpha: 0, duration: 460, ease: 'Cubic.easeOut', onComplete: () => this.ringA.setVisible(false) });
    if (drama.doubleRing) {
      this.ringB.setVisible(true).setAlpha(0.8).setScale(0.12).setTint(ringTint);
      this.after(130, () => {
        this.ringB.play(VFX_ANIMATIONS.shockwave.animationKey);
        this.sceneRef.tweens.add({ targets: this.ringB, scale: 1.25, alpha: 0, duration: 520, ease: 'Cubic.easeOut', onComplete: () => this.ringB.setVisible(false) });
      });
    }

    this.sceneRef.tweens.add({ targets: this.rays, alpha: drama.rayAlpha, duration: 260 });
    this.sceneRef.tweens.add({ targets: this.rays, angle: 360, duration: 16000, repeat: -1 });
    this.sceneRef.tweens.add({ targets: this.glow, alpha: drama.gold ? 0.72 : 0.58, scale: this.haloBaseScale * 1.15, duration: 320 });

    this.scatter(drama.sparks);

    if (drama.punch) {
      this.sceneRef.tweens.add({ targets: this.card, scale: { from: 1, to: 1.06 }, duration: 150, yoyo: true, ease: 'Quad.easeOut' });
    }

    if (drama.portal) {
      this.portal.setVisible(true).setAlpha(0).setAngle(0).setScale(this.portalBaseScale * 0.6).play(VFX_ANIMATIONS.portal.animationKey);
      this.sceneRef.tweens.add({ targets: this.portal, alpha: 0.85, scale: this.portalBaseScale, duration: 420, ease: 'Back.easeOut' });
    }

    this.flames.forEach((flame, index) => {
      if (index >= drama.flames) return;
      const lay = this.flameLayout(index);
      flame.setVisible(true).setAlpha(0).setPosition(lay.x, lay.y).setScale(lay.sx * 0.5, lay.sy * 0.5).play(VFX_ANIMATIONS.flame.animationKey);
      this.sceneRef.tweens.add({ targets: flame, alpha: 0.95, scaleX: lay.sx, scaleY: lay.sy, duration: 260, ease: 'Back.easeOut', delay: index * 45 });
    });

    this.sceneRef.cameras.main.shake(drama.shakeMs, drama.shakeIntensity);
  }

  private settle(): void {
    this.settled = true;
    this.sceneRef.tweens.add({ targets: this.banner, y: this.bannerY, duration: 340, ease: 'Back.easeOut' });
    this.sceneRef.tweens.add({ targets: this.info, alpha: 1, y: this.infoY, duration: 260, ease: 'Quad.easeOut' });
    this.sceneRef.tweens.add({ targets: this.button, alpha: 1, scale: 1, duration: 280, ease: 'Back.easeOut', delay: 120 });
    this.sceneRef.tweens.add({
      targets: this.buttonGlow,
      alpha: 0.3,
      scale: 1.1,
      duration: 620,
      yoyo: true,
      repeat: -1,
      delay: 400,
      ease: 'Sine.easeInOut',
    });
  }

  dismiss(): void {
    if (this.current === null || this.dismissing) return;
    this.dismissing = true;
    this.clearScheduled();
    const token = this.exitToken + 1;
    this.exitToken = token;
    this.sceneRef.tweens.add({ targets: this, alpha: 0, y: 36, duration: EXIT_MS, ease: 'Quad.easeIn' });
    window.setTimeout(() => {
      if (token !== this.exitToken) return;
      this.finalize();
    }, EXIT_MS + 30);
  }

  private finalize(): void {
    this.clearScheduled();
    const targets: Phaser.GameObjects.GameObject[] = [
      this, this.shade, this.card, this.hero, this.glow, this.rays, this.banner, this.info,
      this.button, this.buttonGlow, this.flash, this.ringA, this.ringB, this.portal,
      this.trimT, this.trimB, this.trimL, this.trimR, ...this.flames, ...this.sparkles,
    ];
    for (const target of targets) this.sceneRef.tweens.killTweensOf(target);

    this.setVisible(false).setAlpha(1).setPosition(0, 0);
    this.card.setScale(1).setAlpha(1);
    this.hero.setScale(0);
    this.heroShown = false;
    this.settled = false;
    this.info.setAlpha(0);
    this.button.setAlpha(0).setScale(0.6);
    this.glow.setScale(this.haloBaseScale * 0.5).setAlpha(0.08);
    this.rays.setAlpha(0).setAngle(0);
    this.portal.setVisible(false).setAlpha(0);
    this.ringA.setVisible(false).setAlpha(0);
    this.ringB.setVisible(false).setAlpha(0);
    this.flash.setVisible(false).setFillStyle(0xffffff, 0);
    for (const flame of this.flames) flame.setVisible(false).setAlpha(0);
    for (const sparkle of this.sparkles) sparkle.setAlpha(0);

    this.core.setSpeed(this.resumeSpeed);
    this.current = null;
    this.dismissing = false;
    this.ignoreNextPointerUp = false;
    this.showNext();
  }

  private after(delay: number, run: () => void): void {
    const id = window.setTimeout(() => {
      const at = this.scheduled.indexOf(id);
      if (at >= 0) this.scheduled.splice(at, 1);
      run();
    }, delay);
    this.scheduled.push(id);
  }

  private clearScheduled(): void {
    for (const id of this.scheduled) window.clearTimeout(id);
    this.scheduled.length = 0;
  }

  private drawRays(): void {
    this.rays.clear();
    const count = this.drama.rays;
    const color = this.drama.gold ? 0xffe6a0 : mixColor(this.accent, 0xfff3d0, 0.55);
    for (let i = 0; i < count; i += 1) {
      const a = (Math.PI * 2 * i) / count + 0.13;
      const r = i % 2 === 0 ? this.rayLen : this.rayLen * 0.68;
      this.rays.fillStyle(color, i % 2 === 0 ? 0.26 : 0.18);
      this.rays.fillTriangle(
        0,
        0,
        Math.cos(a - 0.045) * r,
        Math.sin(a - 0.045) * r * this.raySquash,
        Math.cos(a + 0.045) * r,
        Math.sin(a + 0.045) * r * this.raySquash,
      );
    }
  }

  private scatter(count: number): void {
    this.sparkles.forEach((sparkle, index) => {
      const active = index < count;
      this.sceneRef.tweens.killTweensOf(sparkle);
      sparkle.setPosition(0, this.heroCY).setAlpha(active ? 1 : 0).setScale(active ? 0.18 : 0).setAngle(0);
      if (!active) return;
      sparkle.play(VFX_ANIMATIONS.merge.animationKey);
      const angle = (Math.PI * 2 * index) / count;
      const targetY = Phaser.Math.Clamp(
        this.heroCY + Math.sin(angle) * (130 + (index % 4) * 44),
        -this.cardH / 2 + 60,
        this.infoY - 44,
      );
      this.sceneRef.tweens.add({
        targets: sparkle,
        x: Math.cos(angle) * (170 + (index % 3) * 58),
        y: targetY,
        angle: index % 2 === 0 ? 220 : -220,
        alpha: 0,
        scale: 0.04,
        duration: 620 + (index % 3) * 90,
        ease: 'Cubic.easeOut',
      });
    });
  }

  private updateIdleFrame(time: number): void {
    const tier = this.current;
    if (tier === null || !this.heroFrameAnim) return;
    this.hero.setFrame(ninjaIdleFrameAt(time, tier * 379 + 101, tier === FLAME_SHOGUN_TIER));
  }

  override destroy(fromScene?: boolean): void {
    this.clearScheduled();
    this.sceneRef.events.off(Phaser.Scenes.Events.UPDATE, this.updateIdleFrame, this);
    super.destroy(fromScene);
  }
}
