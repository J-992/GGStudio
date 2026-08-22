import Phaser from 'phaser';
import { ATLAS_KEY } from '../render/atlasConfig';
import { themeForStage, type ArenaTheme } from '../data/arenaThemes';
import { theme } from '../ui/theme';

/**
 * Cohesive portal arena backdrop. Character art is kept separate from these
 * scene backgrounds so the supplied roster remains the only source of units.
 */
export class ArenaScenery extends Phaser.GameObjects.Container {
  /** Surface positions for player feet, ordered left-to-right. */
  readonly platforms = [new Phaser.Math.Vector2(), new Phaser.Math.Vector2(), new Phaser.Math.Vector2()];
  /** Surface position for the current boss's feet. */
  readonly bossPlatform = new Phaser.Math.Vector2();

  private readonly backdrop: Phaser.GameObjects.Image;
  private readonly backdropTransition: Phaser.GameObjects.Image;
  private readonly floor: Phaser.GameObjects.Image;
  private readonly floorTransition: Phaser.GameObjects.Image;
  private readonly deckAccent: Phaser.GameObjects.Graphics;
  private readonly maskShape: Phaser.GameObjects.Graphics;
  private readonly portalGlow: Phaser.GameObjects.Arc;
  private readonly portalCore: Phaser.GameObjects.Image;
  private readonly portalRings: Phaser.GameObjects.Image[];
  private readonly portalMotes: Phaser.GameObjects.Image[];
  private readonly cloudLayers: Phaser.GameObjects.Image[];
  private readonly cloudBases = [new Phaser.Math.Vector2(), new Phaser.Math.Vector2()];
  private readonly lights: Phaser.GameObjects.Arc[];
  private readonly portalCentre = new Phaser.Math.Vector2();
  private accentAlpha = 0.34;
  private portalCoreScale = 1.2;
  private portalRingScale = 2.4;
  private portalBurst = 0;
  private time = 0;
  private currentTheme = themeForStage(1);
  private currentThemeId = '';

  constructor(scene: Phaser.Scene, initialStage = 1) {
    super(scene, 0, 0);
    scene.add.existing(this).setDepth(1);

    const a = theme.layout.arena;
    this.maskShape = scene.add.graphics().fillRect(a.x, a.y, a.w, a.h).setVisible(false);
    this.setMask(this.maskShape.createGeometryMask());

    this.backdrop = scene.add.image(0, 0, this.currentTheme.backdropKey);
    this.backdropTransition = scene.add.image(0, 0, this.currentTheme.backdropKey).setAlpha(0).setVisible(false);
    this.cloudLayers = [
      scene.add.image(0, 0, 'arena_cloud_bank').setTint(0x93a6d6).setAlpha(0.2),
      scene.add.image(0, 0, 'arena_cloud_bank').setTint(0x5e79ad).setAlpha(0.13),
    ];
    this.portalGlow = scene.add.circle(0, 0, 45, 0x893ed0, 0.11).setBlendMode(Phaser.BlendModes.ADD);
    this.portalCore = scene.add
      .image(0, 0, ATLAS_KEY, 'vfx_portal')
      .setTint(0xc999ff)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.68);
    this.portalRings = [
      scene.add.image(0, 0, ATLAS_KEY, 'fx_ring').setTint(0xb676ff).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.42),
      scene.add.image(0, 0, ATLAS_KEY, 'fx_ring').setTint(0x58d8e5).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.28),
    ];
    this.portalMotes = Array.from({ length: 5 }, (_, index) => scene.add
      .image(0, 0, ATLAS_KEY, 'fx_spark')
      .setTint(index % 2 === 0 ? 0xd6a0ff : 0x70e8ef)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.84)
      .setScale(0.25));
    this.lights = Array.from({ length: 8 }, (_, index) => scene.add
      .circle(0, 0, index % 3 === 0 ? 2.6 : 2, index % 3 === 0 ? 0x5fe4e6 : 0xffad5c, 0.45)
      .setBlendMode(Phaser.BlendModes.ADD));
    this.floor = scene.add.image(0, 0, this.currentTheme.floorTextureKey);
    this.floorTransition = scene.add.image(0, 0, this.currentTheme.floorTextureKey).setAlpha(0).setVisible(false);
    this.deckAccent = scene.add.graphics();
    this.add([
      this.backdrop,
      this.backdropTransition,
      ...this.cloudLayers,
      this.portalGlow,
      this.portalCore,
      ...this.portalRings,
      ...this.portalMotes,
      ...this.lights,
      this.floor,
      this.floorTransition,
      this.deckAccent,
    ]);
    this.setStage(initialStage, false);
  }

  /**
   * Selects the act belonging to `stage`. The incoming backdrop and floor sit
   * above the current pair during the dissolve, then hand their textures back
   * to the stable images so repeated stage changes never grow the scene graph.
   */
  setStage(stage: number, animate = true): void {
    const next = themeForStage(stage);
    if (next.id === this.currentThemeId) return;
    this.currentTheme = next;
    this.currentThemeId = next.id;
    this.applyPalette(next);

    this.scene.tweens.killTweensOf([this.backdropTransition, this.floorTransition]);
    if (!animate) {
      this.backdrop.setTexture(next.backdropKey).setAlpha(1);
      this.floor.setTexture(next.floorTextureKey).setAlpha(1);
      this.backdropTransition.setVisible(false).setAlpha(0);
      this.floorTransition.setVisible(false).setAlpha(0);
      this.relayout();
      return;
    }

    this.backdropTransition.setTexture(next.backdropKey).setVisible(true).setAlpha(0);
    this.floorTransition.setTexture(next.floorTextureKey).setVisible(true).setAlpha(0);
    this.relayout();
    this.scene.tweens.add({
      targets: this.backdropTransition,
      alpha: 1,
      duration: 620,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        this.backdrop.setTexture(next.backdropKey);
        this.backdropTransition.setVisible(false).setAlpha(0);
        this.relayout();
      },
    });
    this.scene.tweens.add({
      targets: this.floorTransition,
      alpha: 1,
      duration: 460,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        this.floor.setTexture(next.floorTextureKey);
        this.floorTransition.setVisible(false).setAlpha(0);
        this.relayout();
      },
    });
  }

  override update(_time: number, dt: number): void {
    this.time += dt;
    this.portalBurst = Math.max(0, this.portalBurst - dt / 640);
    this.deckAccent.setAlpha(this.accentAlpha + Math.sin(this.time / 780) * 0.06);
    const breath = 1 + Math.sin(this.time / 620) * 0.055;
    const burst = 1 + this.portalBurst * 0.45;
    this.portalGlow.setScale((1 + Math.sin(this.time / 820) * 0.11) * burst).setAlpha(0.15 + Math.sin(this.time / 620) * 0.04 + this.portalBurst * 0.22);
    this.portalCore.setScale(this.portalCoreScale * breath * burst).setAngle(this.time * 0.011);
    this.portalRings[0]!
      .setScale(this.portalRingScale * (1 + Math.sin(this.time / 750) * 0.045) * burst)
      .setAngle(this.time * 0.018);
    this.portalRings[1]!
      .setScale(this.portalRingScale * 1.22 * (1 - Math.sin(this.time / 900) * 0.035) * burst)
      .setAngle(-this.time * 0.013);
    this.portalMotes.forEach((mote, index) => {
      const angle = this.time / (520 + index * 85) + index * 1.26;
      const radius = 72 + (index % 2) * 15;
      mote
        .setPosition(this.portalCentre.x + Math.cos(angle) * radius, this.portalCentre.y + Math.sin(angle) * radius * 0.78)
        .setScale(0.2 + (Math.sin(angle * 2.4) + 1) * 0.06)
        .setAlpha(0.48 + (Math.sin(angle * 1.8) + 1) * 0.22);
    });
    this.cloudLayers.forEach((cloud, index) => {
      const base = this.cloudBases[index]!;
      cloud.setPosition(
        base.x + Math.sin(this.time / (1_550 + index * 370) + index * 1.2) * (58 + index * 16),
        base.y + Math.sin(this.time / (760 + index * 210) + index) * 4,
      );
    });
    this.lights.forEach((light, index) => {
      const flutter = Math.sin(this.time / (95 + index * 19) + index * 2.37);
      const slowPulse = Math.sin(this.time / (630 + index * 41) + index);
      light.setAlpha(0.22 + (flutter + 1) * 0.14 + (slowPulse + 1) * 0.05).setScale(0.86 + (flutter + 1) * 0.09);
    });
  }

  relayout(): void {
    const a = theme.layout.arena;
    const centre = a.x + a.w / 2;
    const floorHeight = Phaser.Math.Clamp(Math.round(a.h * 0.25), 112, 154);
    const floorTop = a.y + a.h - floorHeight;
    const floorSurfaceY = floorTop + floorHeight * 0.6;

    this.maskShape.clear().fillRect(a.x, a.y, a.w, a.h);
    this.coverArena(this.backdrop);
    this.coverArena(this.backdropTransition);
    for (const surface of [this.floor, this.floorTransition]) {
      surface.setPosition(centre, floorTop + floorHeight / 2).setDisplaySize(a.w + 4, floorHeight);
    }
    this.drawDeckAccent(floorTop);

    this.portalCentre.set(centre, a.y + a.h * 0.53);
    this.portalCoreScale = Math.max(1.06, Math.min(1.32, a.w / 590));
    this.portalRingScale = ((123 * this.portalCoreScale) / 64) * 1.12;
    this.portalGlow.setPosition(this.portalCentre.x, this.portalCentre.y).setRadius(92 * this.portalCoreScale / 1.2);
    this.portalCore.setPosition(this.portalCentre.x, this.portalCentre.y).setScale(this.portalCoreScale);
    this.portalRings.forEach((ring) => ring.setPosition(this.portalCentre.x, this.portalCentre.y).setScale(this.portalRingScale));
    const cloudLocations = [
      { x: 0.38, y: 0.32, width: 1.36, height: 0.29 },
      { x: 0.68, y: 0.48, width: 1.58, height: 0.24 },
    ] as const;
    this.cloudBases.forEach((base, index) => {
      const placement = cloudLocations[index]!;
      base.set(a.x + a.w * placement.x, a.y + a.h * placement.y);
      this.cloudLayers[index]!
        .setPosition(base.x, base.y)
        .setScale((a.w * placement.width) / 920, (a.h * placement.height) / 306);
    });
    const lightLocations = [
      [0.12, 0.53], [0.17, 0.3], [0.28, 0.42], [0.71, 0.43],
      [0.84, 0.31], [0.89, 0.61], [0.76, 0.65], [0.5, 0.18],
    ] as const;
    this.lights.forEach((light, index) => {
      const [x, y] = lightLocations[index]!;
      light.setPosition(a.x + a.w * x, a.y + a.h * y);
    });

    this.platforms[0]!.set(a.x + a.w * 0.29, floorSurfaceY);
    this.platforms[1]!.set(a.x + a.w * 0.42, floorSurfaceY);
    this.platforms[2]!.set(a.x + a.w * 0.55, floorSurfaceY);
    this.bossPlatform.set(a.x + a.w * 0.7, floorSurfaceY);
  }

  /** The spot a boss exits from before walking onto the platform. */
  portalOrigin(): Phaser.Math.Vector2 {
    return new Phaser.Math.Vector2(this.portalCentre.x, this.portalCentre.y + 16);
  }

  /** Boost the existing portal VFX for a boss entrance or large special. */
  pulsePortal(): void {
    this.portalBurst = 1;
  }

  private drawDeckAccent(floorTop: number): void {
    const a = theme.layout.arena;
    this.deckAccent
      .clear()
      .lineStyle(2, this.currentTheme.accent, 0.38)
      .lineBetween(a.x + 38, floorTop + 2, a.x + a.w - 38, floorTop + 2)
      .lineStyle(1, this.currentTheme.floor.lightColor, 0.26)
      .lineBetween(a.x + 56, floorTop + 6, a.x + a.w - 56, floorTop + 6);
  }

  private coverArena(image: Phaser.GameObjects.Image): void {
    const a = theme.layout.arena;
    const scale = Math.max(a.w / Math.max(1, image.width), a.h / Math.max(1, image.height));
    image.setPosition(a.x + a.w / 2, a.y + a.h / 2).setScale(scale);
  }

  private applyPalette(next: ArenaTheme): void {
    this.portalGlow.setFillStyle(next.portalTint, 0.11);
    this.portalCore.setTint(next.portalTint);
    this.portalRings[0]?.setTint(next.portalTint);
    this.portalRings[1]?.setTint(next.vfxTint);
    this.portalMotes.forEach((mote, index) => mote.setTint(index % 2 === 0 ? next.portalTint : next.vfxTint));
    this.lights.forEach((light, index) => light.setFillStyle(index % 3 === 0 ? next.accent : next.vfxTint, 0.45));
    const cloudAlpha: Record<string, readonly [number, number]> = {
      'dojo-dusk': [0.07, 0.04],
      'mountain-temple': [0.16, 0.1],
      'storm-sea': [0.3, 0.22],
      rift: [0.12, 0.08],
      'dragon-shrine': [0.09, 0.06],
    };
    const alphas = cloudAlpha[next.id] ?? [0.1, 0.06];
    this.cloudLayers[0]?.setTint(next.sky.bottom).setAlpha(alphas[0]);
    this.cloudLayers[1]?.setTint(next.sky.top).setAlpha(alphas[1]);
    this.accentAlpha = next.id === 'storm-sea' ? 0.46 : 0.34;
  }
}
