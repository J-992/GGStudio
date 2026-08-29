import Phaser from 'phaser';
import { ATLAS, ATLAS_KEY } from '../render/atlasConfig';
import { bootPortraits, bootThemeArt } from '../render/loadPlan';
import { readResumePoint } from '../render/resumePoint';
import { generatePlaceholderAtlas } from '../render/PlaceholderAtlas';
import { POWERUP_ORDER, POWERUPS } from '../data/powerups';
import { ACHIEVEMENTS_ICON_KEY, ACHIEVEMENTS_ICON_PATH, REVEAL_ASSETS } from '../render/revealAssets';
import { VFX_ANIMATION_ORDER, VFX_ANIMATIONS } from '../data/vfxAssets';
import { stopPlatformLoading } from '../platform/platform';
import { finishSplash, setSplashProgress } from '../splash';
import { BOSS_STICKERS } from '../data/dojoStyles';

export class BootScene extends Phaser.Scene {
  constructor() { super('BootScene'); }

  preload(): void {
    // The HTML loading screen has been on screen since the first frame; this is
    // the first moment there is any real progress to report into it.
    this.load.on('progress', setSplashProgress);

    if (ATLAS.mode === 'file') this.load.atlas(ATLAS_KEY, ATLAS.texturePath, ATLAS.jsonPath);
    this.load.bitmapFont('pixel', 'assets/font.png', 'assets/font.xml');
    // Only the opening slice of the catalog. The rest streams in behind the
    // running game -- see `render/loadPlan.ts` for where the line is drawn and
    // why it is safe to draw one at all.
    // Keyed to where this save resumes, not to stage 1 -- see resumePoint.ts.
    const resume = readResumePoint();
    for (const portrait of bootPortraits(resume)) {
      if (portrait.animation !== undefined) {
        this.load.spritesheet(portrait.textureKey, portrait.texturePath, portrait.animation);
      } else {
        this.load.image(portrait.textureKey, portrait.texturePath);
      }
    }
    // The cloud bank is a parallax layer over every arena, not a themed
    // backdrop, so it is needed from the first frame regardless of stage.
    this.load.image('arena_cloud_bank', 'assets/arena-cloud-bank.webp');
    for (const art of bootThemeArt(resume)) this.load.image(art.key, art.path);
    this.load.image('dojo_roster_deck', 'assets/dojo-roster-deck.webp');
    this.load.image('slot_locked', 'assets/slot-locked.webp');
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
    this.load.image('tutorial_hand', 'assets/tutorial-hand.webp');
    for (const sticker of BOSS_STICKERS) this.load.image(sticker.textureKey, sticker.texturePath);
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
        frames: this.anims.generateFrameNumbers(effect.textureKey, { start: 0, end: effect.frames - 1 }),
        frameRate: effect.frameRate,
        repeat: 0,
      });
    }
    // Every texture and animation the game opens with now exists, which is the
    // only honest moment to take Poki's loader down: report it before the
    // handoff so their spinner does not sit over a game that is already up.
    void stopPlatformLoading();
    this.scene.start('GameScene');

    // Dropped after the scene starts, not before: GameScene builds its whole
    // first frame synchronously, so fading here means the splash comes off a
    // drawn board rather than off a blank canvas.
    finishSplash();
  }
}
