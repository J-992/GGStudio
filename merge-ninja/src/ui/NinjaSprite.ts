import Phaser from 'phaser';
import { ninjaDef } from '../data/ninjas';
import { ninjaIdleFrameAt } from '../data/presentation';
import { FLAME_SHOGUN_TIER, ninjaCatalogPortrait } from '../render/atlasConfig';

/**
 * Where the ink actually sits inside the 128px character frame, measured from
 * the packed sheet. The art is drawn feet-on-origin, so the body lives *above*
 * the container position -- which is why the grab test has to be derived from
 * these numbers instead of a circle around (x, y).
 */
const ART = { halfWidth: 62, top: 126, bottom: 2 } as const;

/** Extra grab margin, in unscaled art pixels, around the body. */
const GRAB_PAD = 14;

/** Full-body source art with a low-foot pivot and authored weapon-ready frames. */
export class NinjaSprite extends Phaser.GameObjects.Container {
  readonly image: Phaser.GameObjects.Sprite;
  readonly badge: Phaser.GameObjects.BitmapText;
  homeX: number;
  homeY: number;
  private readonly pose: Phaser.GameObjects.Container;
  private readonly badgePlate: Phaser.GameObjects.NineSlice;
  private readonly sceneRef: Phaser.Scene;
  private readonly hasFrameAnimation: boolean;
  private artScale = 1;

  constructor(scene: Phaser.Scene, readonly id: number, readonly tier: number, x: number, y: number) {
    super(scene, x, y);
    this.sceneRef = scene;
    this.homeX = x;
    this.homeY = y;
    scene.add.existing(this);

    const def = ninjaDef(tier);
    const catalogPortrait = ninjaCatalogPortrait(tier);
    this.hasFrameAnimation = catalogPortrait?.animation !== undefined;
    this.pose = new Phaser.GameObjects.Container(scene, 0, 0);
    this.image = scene.add.sprite(
      0,
      -64 + (catalogPortrait?.footInset ?? 0),
      def.textureKey,
    );
    // The final supplied evolution is intentionally wide. Normalising from
    // frame height keeps it fully inside a roster cell.
    this.image.setScale(128 / this.image.frame.height).setTint(def.artTint);
    this.pose.add(this.image);
    this.add(this.pose);

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
    const index = ninjaIdleFrameAt(
      time,
      this.id * 211 + this.tier * 379,
      this.tier === FLAME_SHOGUN_TIER,
    );
    this.image.setFrame(index);
    this.pose.setPosition(0, 0).setAngle(0).setScale(this.artScale);
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
    this.badgePlate.setPosition(ART.halfWidth * scale - 16, -ART.bottom * scale - 16);
    this.badge.setPosition(this.badgePlate.x, this.badgePlate.y);
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
    const halfWidth = ART.halfWidth * this.artScale + GRAB_PAD;
    const top = this.y - ART.top * this.artScale - GRAB_PAD * 0.5;
    const bottom = this.y - ART.bottom * this.artScale + GRAB_PAD;
    return new Phaser.Geom.Rectangle(this.x - halfWidth, top, halfWidth * 2, bottom - top);
  }

  /** Centre of the full drawn body -- the point a drag should track. */
  bodyCenterY(): number {
    return this.y - ((ART.top + ART.bottom) / 2) * this.artScale;
  }
}
