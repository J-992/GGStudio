import Phaser from 'phaser';
import {
  ATLAS,
  ATLAS_KEY,
  BOSS_CATALOG_PORTRAITS,
  NINJA_CATALOG_PORTRAITS,
} from '../render/atlasConfig';
import { generatePlaceholderAtlas } from '../render/PlaceholderAtlas';
import { POWERUP_ORDER, POWERUPS } from '../data/powerups';
import { ACHIEVEMENTS_ICON_KEY, ACHIEVEMENTS_ICON_PATH, REVEAL_ASSETS } from '../render/revealAssets';
import { VFX_ANIMATION_ORDER, VFX_ANIMATIONS } from '../data/vfxAssets';
import { FLOOR_THEMES_MANIFEST } from '../data/arenaThemes';
import { stopPlatformLoading } from '../platform/platform';

export class BootScene extends Phaser.Scene {
  constructor() { super('BootScene'); }

  preload(): void {
    if (ATLAS.mode === 'file') this.load.atlas(ATLAS_KEY, ATLAS.texturePath, ATLAS.jsonPath);
    this.load.bitmapFont('pixel', 'assets/font.png', 'assets/font.xml');
    for (const portrait of [...NINJA_CATALOG_PORTRAITS, ...BOSS_CATALOG_PORTRAITS]) {
      if (portrait.animation !== undefined) {
        this.load.spritesheet(portrait.textureKey, portrait.texturePath, portrait.animation);
      } else {
        this.load.image(portrait.textureKey, portrait.texturePath);
      }
    }
    this.load.image('arena_rift_stage', 'assets/arena-rift-stage.webp');
    this.load.image('arena_cloud_bank', 'assets/arena-cloud-bank.webp');
    this.load.image('dojo_night_backdrop', 'assets/dojo-night-backdrop.webp');
    this.load.image('arena_mountain', 'assets/arena-mountain.webp');
    this.load.image('arena_storm', 'assets/arena-storm.webp');
    this.load.image('arena_shrine', 'assets/arena-shrine.webp');
    for (const floorKey of FLOOR_THEMES_MANIFEST) {
      this.load.image(floorKey, `assets/${floorKey.replace('_', '-')}.webp`);
    }
    this.load.image('dojo_roster_deck', 'assets/dojo-roster-deck.webp');
    for (const id of POWERUP_ORDER) {
      const powerup = POWERUPS[id];
      this.load.image(powerup.iconTexture, powerup.iconPath);
    }
    for (const id of VFX_ANIMATION_ORDER) {
      const effect = VFX_ANIMATIONS[id];
      this.load.spritesheet(effect.textureKey, effect.path, {
        frameWidth: effect.frameWidth,
        frameHeight: effect.frameHeight,
        endFrame: effect.frames - 1,
      });
    }
    for (const asset of Object.values(REVEAL_ASSETS)) this.load.image(asset.key, asset.path);
    // The atlas carries no trophy, and the achievements rail button must not
    // reuse the ascension star: two unrelated systems reading as one control.
    this.load.image(ACHIEVEMENTS_ICON_KEY, ACHIEVEMENTS_ICON_PATH);
    for (let i = 0; i < 6; i += 1) this.load.image(`tex_${i}`, `assets/tex/tex_${i}.webp`);
    this.load.image('tex_industrial', 'assets/tex/tex_industrial.webp');
  }

  create(): void {
    if (ATLAS.mode === 'placeholder') generatePlaceholderAtlas(this);
    for (const id of VFX_ANIMATION_ORDER) {
      const effect = VFX_ANIMATIONS[id];
      if (this.anims.exists(effect.animationKey)) continue;
      this.anims.create({
        key: effect.animationKey,
        frames: this.anims.generateFrameNumbers(effect.textureKey, {
          start: 0,
          end: effect.frames - 1,
        }),
        frameRate: effect.frameRate,
        repeat: 0,
      });
    }
    // Every texture and animation the game opens with now exists, which is the
    // only honest moment to take Poki's loader down: report it before the
    // handoff so their spinner does not sit over a game that is already up.
    void stopPlatformLoading();
    this.scene.start('GameScene');
  }
}
