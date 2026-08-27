import Phaser from 'phaser';
import { ninjaDef } from '../data/ninjas';
import { FINAL_NINJA_TIER, ninjaBoardAnchorY, ninjaIdleFrameAt, ninjaScale } from '../data/presentation';
import { FLAME_SHOGUN_TIER, ninjaCatalogPortrait } from '../render/atlasConfig';
import { portraitTexture } from '../render/portraitTexture';
import type { DojoStyleDef } from '../data/dojoStyles';

/**
 * Where the ink actually sits inside the 128px character frame, measured from
 * the packed sheet. The art is drawn feet-on-origin, so the body lives *above*
 * the container position -- which is why the grab test has to be derived from
 * these numbers instead of a circle around (x, y).
 */
const ART = { halfWidth: 62, top: 126, bottom: 2 } as const;

/** Extra grab margin, in unscaled art pixels, around the body. */
const GRAB_PAD = 14;

/**
 * The idle breathing float layered under the four-frame cycle: small enough
 * to read as alive rather than jittery, slow enough not to compete with the
 * frame swap it rides on top of.
 */
const IDLE_BOB = { amplitudeArtPx: 2.4, periodMs: 2100 } as const;

/** Full-body source art with a low-foot pivot and authored weapon-ready frames. */
export class NinjaSprite extends Phaser.GameObjects.Container {
  readonly image: Phaser.GameObjects.Sprite;
  readonly badge: Phaser.GameObjects.BitmapText;
  homeX: number;
  homeY: number;
  private readonly pose: Phaser.GameObjects.Container;
  private readonly cosmeticAura: Phaser.GameObjects.Ellipse;
  private readonly badgePlate: Phaser.GameObjects.NineSlice;
  private readonly sceneRef: Phaser.Scene;
  private hasFrameAnimation: boolean;
  private artScale = 1;
  private imageScale = 1;

  constructor(scene: Phaser.Scene, readonly id: number, readonly tier: number, x: number, y: number) {
    super(scene, x, y);
    this.sceneRef = scene;
    this.homeX = x;
    this.homeY = y;
    scene.add.existing(this);

    const def = ninjaDef(tier);
    const art = portraitTexture(scene, def, ninjaCatalogPortrait(tier));
    this.hasFrameAnimation = art.animated;
    this.pose = new Phaser.GameObjects.Container(scene, 0, 0);
    this.cosmeticAura = scene.add
      .ellipse(0, -12, 92, 28, 0xffc85b, 0.22)
      .setStrokeStyle(2, 0xffef9a, 0.65)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false);
    this.image = scene.add.sprite(0, 0, art.key, art.frame);
    this.imageScale = ninjaScale(this.image.frame.width, this.image.frame.height, 128, tier);
    this.image
      .setPosition(0, ninjaBoardAnchorY(this.image.frame.height, this.imageScale, art.footInset, tier))
      .setScale(this.imageScale)
      .setTint(def.artTint);
    this.pose.add(this.image);
    this.add([this.cosmeticAura, this.pose]);

    // The tier chip sits outside the pose container so it neither bobs with the
    // swing nor shrinks with the roster scale: it is UI, and it has to stay
    // legible at every board size.
    this.badgePlate = scene.add.nineslice(0, 0, 'game', 'banner_name_9', 38, 24, 11, 11, 7, 7);
    // Two-digit tiers need a wider flat section or the digits ride up onto
    // the nine-slice's rounded caps ('29' measures 24px against 16px of
    // stretched middle at the default 38px plate).
    this.badgePlate.width = String(tier).length > 1 ? 48 : 38;
    this.badge = scene.add.bitmapText(0, 0, 'pixel', String(tier), 14).setOrigin(0.5);
    this.add([this.badgePlate, this.badge]);

    this.setSize(130, 130);
    // Each strip carries its own weapon/attachment movement. Resolve the
    // frame from the scene clock rather than using a chained tween so board
    // syncs never restart the animation, and never transform the whole body.
    if (this.hasFrameAnimation) {
      scene.events.on(Phaser.Scenes.Events.UPDATE, this.updateIdleFrame, this);
      this.updateIdleFrame(scene.time.now);
    }
  }

  /** Four source-authored weapon-ready frames, phase-shifted per roster card. */
  private updateIdleFrame(time: number): void {
    if (!this.active || !this.hasFrameAnimation) return;
    const phase = this.id * 211 + this.tier * 379;
    const index = ninjaIdleFrameAt(time, phase, this.tier === FLAME_SHOGUN_TIER);
    this.image.setFrame(index);
    const bob = Math.sin(((time + phase) / IDLE_BOB.periodMs) * Math.PI * 2) * IDLE_BOB.amplitudeArtPx;
    this.pose.setPosition(0, bob * this.artScale).setAngle(0).setScale(this.artScale);
  }

  setHome(x: number, y: number): void {
    this.homeX = x;
    this.homeY = y;
  }

  setRosterScale(scale: number): void {
    this.artScale = scale;
    if (this.hasFrameAnimation) this.updateIdleFrame(this.sceneRef.time.now);
    else this.pose.setScale(scale);
    // Tucked inside the cell: hung off the art's edge it clipped the next
    // column and sat on the head of the ninja in the row below.
    const badgeHalfWidth = this.tier === FINAL_NINJA_TIER
      ? this.image.frame.width * this.imageScale / 2
      : ART.halfWidth;
    this.badgePlate.setPosition(badgeHalfWidth * scale - 16, -ART.bottom * scale - 16);
    this.badge.setPosition(this.badgePlate.x, this.badgePlate.y);
  }

  applyDojoStyle(style: DojoStyleDef): void {
    const crimson = style.id === 'crimson-dojo';
    this.cosmeticAura
      .setVisible(crimson)
      .setFillStyle(style.palette.ninjaAura, crimson ? 0.2 : 0)
      .setStrokeStyle(2, style.palette.accentBright, crimson ? 0.72 : 0);
    this.badgePlate.setTint(crimson ? style.palette.plate : 0xffffff);
    this.badge.setTint(crimson ? 0xfff2c7 : 0xffffff);
  }

  /**
   * Replaces the temporary atlas pose once a streamed portrait strip arrives.
   * Tiers beyond the boot window are intentionally allowed to spawn before
   * their art has downloaded; without this handoff they stayed on the static
   * fallback forever, even though the authored frames were already in memory.
   */
  refreshPortrait(): void {
    const def = ninjaDef(this.tier);
    const art = portraitTexture(this.sceneRef, def, ninjaCatalogPortrait(this.tier));
    if (art.key === this.image.texture.key && art.frame === this.image.frame.name && art.animated === this.hasFrameAnimation) return;

    this.hasFrameAnimation = art.animated;
    this.image
      .setTexture(art.key, art.frame)
      .setScale(this.imageScale = ninjaScale(this.image.frame.width, this.image.frame.height, 128, this.tier))
      .setPosition(0, ninjaBoardAnchorY(this.image.frame.height, this.imageScale, art.footInset, this.tier))
      .setTint(def.artTint);
    this.setRosterScale(this.artScale);
  }

  override destroy(fromScene?: boolean): void {
    this.sceneRef.events.off(Phaser.Scenes.Events.UPDATE, this.updateIdleFrame, this);
    super.destroy(fromScene);
  }

  /**
   * The body's on-screen box, padded for fingers. Grabbing is tested against
   * this rather than a radius so the character itself is the target instead of
   * the empty tile below its feet.
   */
  grabBounds(): Phaser.Geom.Rectangle {
    const finalDragon = this.tier === FINAL_NINJA_TIER;
    const halfWidth = (finalDragon ? this.image.frame.width * this.imageScale / 2 : ART.halfWidth) * this.artScale + GRAB_PAD;
    const top = this.y - (finalDragon ? ART.top * this.imageScale : ART.top) * this.artScale - GRAB_PAD * 0.5;
    const bottom = this.y - ART.bottom * this.artScale + GRAB_PAD;
    return new Phaser.Geom.Rectangle(this.x - halfWidth, top, halfWidth * 2, bottom - top);
  }

  /** Centre of the full drawn body -- the point a drag should track. */
  bodyCenterY(): number {
    const heightScale = this.tier === FINAL_NINJA_TIER ? this.imageScale : 1;
    return this.y - ((ART.top + ART.bottom) / 2) * heightScale * this.artScale;
  }
}
