import Phaser from 'phaser';
import type { GameCore } from '../core/GameCore';
import type { GameEvent } from '../core/EventBus';
import type { DojoStyleDef } from '../data/dojoStyles';
import { ATLAS_KEY } from '../render/atlasConfig';
import type { Sfx } from '../audio/Sfx';
import { theme } from './theme';

const STICKER_SIZE = 128;
/** Clears the die-cut art's own glow so the caption never sits on the seal. */
const CAPTION_GAP = 34;
const HOLD_MS = 900;
const FINALE_HOLD_MS = 1_500;

/**
 * The moment a boss seal is earned -- and nothing more.
 *
 * Stickers are a collectible, so the collection lives in the almanac's styles
 * page and the arena keeps its space. This is only the hand-off: the seal
 * flourishes over the arena, sweeps its gloss, then flies into the book button
 * so the player learns where it went. Nothing here is interactive and nothing
 * survives the tween.
 */
export class StickerEarned extends Phaser.GameObjects.Container {
  private readonly sticker: Phaser.GameObjects.Image;
  /** A white-tinted duplicate cropped to a moving strip; the PNG alpha shapes the band, so the gloss follows the die-cut silhouette. */
  private readonly shine: Phaser.GameObjects.Image;
  private readonly caption: Phaser.GameObjects.BitmapText;
  private readonly captionPlate: Phaser.GameObjects.Rectangle;
  private style: DojoStyleDef;
  private tutorialHidden = false;
  private lastId = '';
  /** A seal earned while the draft row is open, waiting for the cards to clear. */
  private queued: Extract<GameEvent, { type: 'bossStickerCollected' }> | null = null;

  constructor(
    private readonly sceneRef: Phaser.Scene,
    private readonly core: GameCore,
    private readonly sfx: Sfx,
    /** Pulses the almanac book once the seal lands in it. */
    private readonly onLanded: () => void,
  ) {
    super(sceneRef, 0, 0);
    sceneRef.add.existing(this).setDepth(286);
    this.style = core.equippedDojoStyle;

    this.sticker = sceneRef.add.image(0, 0, ATLAS_KEY, 'fx_spark').setDisplaySize(STICKER_SIZE, STICKER_SIZE);
    this.shine = sceneRef.add
      .image(0, 0, ATLAS_KEY, 'fx_spark')
      .setDisplaySize(STICKER_SIZE, STICKER_SIZE)
      .setTintFill(0xffffff)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0)
      .setVisible(false);
    // The caption lands over the dojo floor and whoever is fighting on it, so
    // it carries its own plate rather than trusting the backdrop to be dark.
    this.captionPlate = sceneRef.add
      .rectangle(0, STICKER_SIZE / 2 + CAPTION_GAP + 12, 240, 46, 0x140d10, 0.82)
      .setStrokeStyle(2, this.style.palette.accentBright, 0.7);
    this.caption = sceneRef.add
      .bitmapText(0, STICKER_SIZE / 2 + CAPTION_GAP, 'pixel', '', 14)
      .setOrigin(0.5, 0)
      .setCenterAlign()
      .setTint(this.style.palette.accentBright);
    this.add([this.sticker, this.shine, this.captionPlate, this.caption]);
    this.setVisible(false).setAlpha(0);

    core.events.on('bossStickerCollected', (event) => this.play(event));
    core.events.on('draftPicked', () => this.flushQueued());
    this.relayout();
  }

  relayout(): void {
    const a = theme.layout.arena;
    this.setScale(Math.min(1, Math.max(0.82, a.w / 684)));
  }

  setTutorialHidden(hidden: boolean): void {
    this.tutorialHidden = hidden;
  }

  applyDojoStyle(style: DojoStyleDef): void {
    this.style = style;
    this.caption.setTint(style.palette.accentBright);
    this.captionPlate.setStrokeStyle(2, style.palette.accentBright, 0.7);
  }

  snapshot(): { visible: boolean; id: string } {
    return { visible: this.visible, id: this.lastId };
  }

  /**
   * Seals land on stages 5 and 10, which is exactly where the draft deals its
   * cards. Two rewards cannot share the middle of the arena, so the seal waits
   * its turn rather than being dealt over.
   *
   * The sim emits the seal a beat before it offers the draft, so the decision
   * costs one frame: by then the row has declared itself either way.
   */
  private play(event: Extract<GameEvent, { type: 'bossStickerCollected' }>): void {
    this.sceneRef.time.delayedCall(80, () => {
      if (this.core.pendingDraft !== null) this.queued = event;
      else this.begin(event);
    });
  }

  private begin(event: Extract<GameEvent, { type: 'bossStickerCollected' }>): void {
    this.lastId = event.id;
    this.sceneRef.tweens.killTweensOf(this);
    this.sceneRef.tweens.killTweensOf(this.sticker);

    this.sticker.setTexture(event.textureKey).setDisplaySize(STICKER_SIZE, STICKER_SIZE);
    this.shine.setTexture(event.textureKey).setDisplaySize(STICKER_SIZE, STICKER_SIZE).setVisible(false).setAlpha(0).setCrop();
    this.caption.setText(
      event.pageComplete
        ? 'BOSS SEAL 3/3\nSET COMPLETE'
        : `BOSS SEAL ${event.progress}/${event.total}\nSAVED TO YOUR BOOK`,
    );
    const bounds = this.caption.getTextBounds().local;
    this.captionPlate
      .setSize(Math.round(bounds.width) + 28, Math.round(bounds.height) + 18)
      .setPosition(0, this.caption.y + bounds.height / 2);

    this.relayout();
    const a = theme.layout.arena;
    // Low in the arena on purpose: the stage banner owns 0.3h, and the two
    // celebrations landing on the same boss must not stack on each other.
    this.setPosition(a.x + a.w / 2, a.y + a.h * 0.56)
      .setVisible(true)
      .setAlpha(0)
      .setAngle(event.slot % 2 === 0 ? -9 : 9);
    const scale = this.scaleX;
    this.setScale(scale * 0.45);
    this.sfx.play(event.pageComplete ? 'newTier' : 'pickup');

    this.sceneRef.tweens.add({
      targets: this,
      alpha: 1,
      scaleX: scale,
      scaleY: scale,
      angle: 0,
      duration: 420,
      ease: 'Back.easeOut',
      onComplete: () => this.playGloss(event.pageComplete),
    });
  }

  private flushQueued(): void {
    const event = this.queued;
    if (event === null) return;
    this.queued = null;
    // Long enough for the picked card to fly off before the seal arrives.
    this.sceneRef.time.delayedCall(700, () => this.play(event));
  }

  private playGloss(finale: boolean): void {
    const frameW = Math.max(1, this.shine.frame.realWidth);
    const frameH = Math.max(1, this.shine.frame.realHeight);
    const sweep = { x: -Math.round(frameW * 0.22) };
    const band = Math.max(22, Math.round(frameW * 0.18));
    this.shine.setVisible(true).setAlpha(0.78).setCrop(0, 0, band, frameH);
    this.sceneRef.tweens.add({
      targets: sweep,
      x: frameW,
      duration: 640,
      ease: 'Sine.easeInOut',
      onUpdate: () => this.shine.setCrop(Math.max(0, sweep.x), 0, band, frameH),
      onComplete: () => this.shine.setVisible(false).setAlpha(0).setCrop(),
    });
    this.sparkleBurst(finale ? 16 : 9);
    this.sceneRef.time.delayedCall(finale ? FINALE_HOLD_MS : HOLD_MS, () => this.flyToBook());
  }

  /**
   * The seal travels to the book so the collection has a visible home. While
   * the first-run chrome hides that button there is nothing to fly to, so the
   * card simply fades where it stands.
   */
  private flyToBook(): void {
    if (this.tutorialHidden) {
      this.sceneRef.tweens.add({
        targets: this,
        alpha: 0,
        duration: 320,
        ease: 'Quad.easeOut',
        onComplete: () => this.setVisible(false),
      });
      return;
    }
    const book = theme.layout.almanac;
    this.sceneRef.tweens.add({
      targets: this,
      x: book.x,
      y: book.y,
      scaleX: this.scaleX * 0.16,
      scaleY: this.scaleY * 0.16,
      alpha: 0.15,
      duration: 560,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        this.setVisible(false).setAlpha(0);
        this.onLanded();
      },
    });
  }

  private sparkleBurst(count: number): void {
    for (let index = 0; index < count; index += 1) {
      const angle = (Math.PI * 2 * index) / count;
      const spark = this.sceneRef.add
        .image(this.x, this.y, ATLAS_KEY, 'fx_spark')
        .setDepth(this.depth + 1)
        .setTint(index % 3 === 0 ? 0xffffff : 0xffd56b)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setScale(0.5)
        .setAlpha(0.95);
      this.sceneRef.tweens.add({
        targets: spark,
        x: spark.x + Math.cos(angle) * (74 + (index % 3) * 11),
        y: spark.y + Math.sin(angle) * (60 + (index % 2) * 10),
        angle: 180,
        scale: 0.08,
        alpha: 0,
        duration: 520 + (index % 3) * 80,
        ease: 'Cubic.easeOut',
        onComplete: () => spark.destroy(),
      });
    }
  }
}
